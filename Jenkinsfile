pipeline {
    agent {
        kubernetes {
            label 'keda-bot-agent'
            yamlFile 'pod.yaml'
        }
    }

    environment {
        DOCKER_IMAGE = 'docin82/keda-bot'
        GITOPS_REPO = 'github.com/goncharukinna/bots-gitops.git'
        GITOPS_PATH = 'manifests/keda-bot/deployment.yaml'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                echo "✅ Код склонирован"
            }
        }

        // Если в проекте нет тестов или зависимостей для dev, эту стадию можно удалить
        stage('Install Dependencies') {
            steps {
                container('node') {
                    sh 'npm install --registry=https://registry.npmmirror.com'
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                container('docker') {
                    script {
                        sh "docker build -t ${DOCKER_IMAGE}:${env.BUILD_ID} ."
                        sh "docker tag ${DOCKER_IMAGE}:${env.BUILD_ID} ${DOCKER_IMAGE}:latest"
                    }
                }
            }
        }

        stage('Push to Registry') {
            steps {
                container('docker') {
                    script {
                        withCredentials([usernamePassword(
                            credentialsId: 'docker-credentials', 
                            usernameVariable: 'DOCKER_USER', 
                            passwordVariable: 'DOCKER_PASS'
                        )]) {
                            sh '''
                                echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                                docker push ${DOCKER_IMAGE}:${BUILD_ID}
                                docker push ${DOCKER_IMAGE}:latest
                            '''
                        }
                    }
                }
            }
        }

        stage('Update GitOps Repo') {
            steps {
                container('git') {
                    withCredentials([usernamePassword(
                        credentialsId: 'github-token',
                        usernameVariable: 'GIT_USER',
                        passwordVariable: 'GIT_TOKEN'
                    )]) {
                        sh '''
                            git clone https://${GIT_USER}:${GIT_TOKEN}@${GITOPS_REPO} /tmp/gitops
                            cd /tmp/gitops
                            
                            sed -i "s|image: ${DOCKER_IMAGE}:.*|image: ${DOCKER_IMAGE}:${BUILD_ID}|" ${GITOPS_PATH}
                            
                            git config user.name "Jenkins"
                            git config user.email "jenkins@example.com"
                            git add ${GITOPS_PATH}
                            git commit -m "keda-bot: update to ${BUILD_ID} [skip ci]"
                            git push
                        '''
                    }
                }
            }
        }
    }

    post {
        success {
            echo "🎉 keda-bot ${BUILD_ID} собран и обновлён в GitOps"
        }
        failure {
            echo "❌ Ошибка сборки"
        }
    }
}
