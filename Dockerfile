FROM public.ecr.aws/docker/library/python:3.9-alpine3.15
WORKDIR /app
COPY app/requirements.txt ./
RUN pip3 install -r requirements.txt
COPY app/* ./
EXPOSE 2000
CMD ["python3", "-m", "flask", "run", "--host=0.0.0.0", "--port=2000"]