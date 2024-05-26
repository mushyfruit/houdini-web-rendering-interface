import os
from dotenv import load_dotenv
from app import redis_client

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))


class Config(object):
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev_string'

    BASE_DIR = "/var/model_storage"
    STATIC_FOLDER = os.path.join(BASE_DIR, 'static')
    USER_RENDER_DIR = os.path.join(STATIC_FOLDER, 'user_renders')

    # Mounted volume between celery and houdini server.
    UPLOAD_FOLDER = "/root/hip_storage"
    ALLOWED_EXTENSIONS = {".hip", ".hiplc", ".hipnc"}

    # Default .glb file to load upon loading site.
    PLACEHOLDER_DIR = "placeholder"
    PLACEHOLDER_FILE = "placeholder.glb"
    PLACEHOLDER_HIP = "placeholder.hiplc"
    PLACEHOLDER_HIP_PATH = f"{STATIC_FOLDER}/{PLACEHOLDER_DIR}/{PLACEHOLDER_HIP}"

    THUMBNAIL_DIR = "user_thumbnails"
    MODEL_DIR = "user_models"

    # Flask session config for redis
    SESSION_TYPE = 'redis'
    SESSION_PERMANENT = False
    SESSION_USE_SIGNER = True
    SESSION_REDIS = redis_client.get_client_instance()

    CELERY = {
        "broker_url": 'redis://redis:6379/0',
        "result_backend": 'redis://redis:6379/0'
    }
