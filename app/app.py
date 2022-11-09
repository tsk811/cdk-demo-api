from flask import Flask
from flask import request
import boto3
import os
import uuid

app = Flask(__name__)

@app.route('/upload', methods=['POST'])
def user():
    if request.files.get('file'):
        result = save_to_s3(request.files.get('file'))
        if result:
            return result, 200
        else:
            return {"message": "File upload failed"}, 500

    return {"message": "No file to upload"}, 400


def save_to_s3(file):
    client = boto3.client("s3")
    key = str(uuid.uuid4())
    try:
        response = client.put_object(
            Body=file,
            Bucket=os.environ.get("BUCKET"),
            Key=key,
            ContentEncoding="base64"
        )
        return {"message": "File upload successful",
                "key": key}
    except:
        return False
