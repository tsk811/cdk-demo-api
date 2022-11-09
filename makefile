#Docker
docker.setup:
	nohup /usr/local/bin/dockerd --host=unix:///var/run/docker.sock --host=tcp://127.0.0.1:2375 --storage-driver=overlay2 &
	timeout 15 sh -c "until docker info; do echo .; sleep 1; done"

docker.build: 
	aws ecr get-login-password --region ${AWS_DEFAULT_REGION} | docker login --username AWS --password-stdin ${ECR_URL_NON_PROD}
	docker build -t ${ECR_URL_NON_PROD}:${TAG} .
	docker tag ${ECR_URL_NON_PROD}:${TAG} ${ECR_URL_NON_PROD}:${SHA}

docker.push: docker.build
	docker push ${ECR_URL_NON_PROD}:${SHA}
	docker push ${ECR_URL_NON_PROD}:${TAG}

docker.push.prod: 
	aws ecr get-login-password --region ${AWS_DEFAULT_REGION} | docker login --username AWS --password-stdin ${ECR_URL_NON_PROD}
	docker pull ${ECR_URL_NON_PROD}:${TAG}
	docker tag ${ECR_URL_NON_PROD}:${TAG} ${ECR_URL_PROD}:${TAG}
	docker tag ${ECR_URL_NON_PROD}:${TAG} ${ECR_URL_PROD}:${SHA}
	aws ecr get-login-password --region ${AWS_DEFAULT_REGION} | docker login --username AWS --password-stdin ${ECR_URL_PROD}
	docker push ${ECR_URL_PROD}:${SHA}
	docker push ${ECR_URL_PROD}:${TAG}

docker.createDef:
	echo "Creating Image Definition"
	printf "[{\"name\":\"${CONTAINER_NAME}\",\"imageUri\":\"${URL}:${SHA}\"}]" > imagedefinitions.json

ecs.deploy:
	aws ecs update-service --cluster ${CLUSTER} --service ${SERVICE} --force-new-deployment

ecs.poll.status:
	aws ecs wait services-stable --cluster ${CLUSTER} --service ${SERVICE}


#npm
install.cdk:
	npm install -g aws-cdk

install: install.cdk
	npm install
	cdk synth

#python
pip.install:
	cd lambda && pip3 install -t . -r ./requirements.txt