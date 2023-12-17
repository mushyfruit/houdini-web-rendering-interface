import os
from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))


class Config(object):
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'hard_to_guess_string'

    # Mounted volume between celery and houdini server.
    UPLOAD_FOLDER = "/root/hip_storage"
    ALLOWED_EXTENSIONS = {".hip", ".hiplc", ".hipnc"}
    PLACEHOLDER_DIR = "placeholder"
    PLACEHOLDER_FILE = "placeholder.glb"

    CELERY = {
        "broker_url": 'redis://redis:6379/0',
        "result_backend": 'redis://redis:6379/0'
    }
