import os
from flask import Flask, request
from flask_socketio import SocketIO

from celery import Celery, Task
from config import Config

socketio = SocketIO()

def celery_init_app(app):

    class FlaskTask(Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app = Celery(app.name, task_cls=FlaskTask)
    celery_app.config_from_object(app.config["CELERY"])
    celery_app.set_default()
    app.extensions["celery"] = celery_app
    return celery_app


def create_app(config_class=Config):
    app = Flask(__name__)

    # Initialize from Config and environment.
    app.config.from_object(config_class)
    app.config.from_prefixed_env()

    socketio.init_app(app)

    celery_init_app(app)

    from app.main import bp as main_bp
    app.register_blueprint(main_bp)

    from app.api import bp as hou_api_bp
    app.register_blueprint(hou_api_bp, url_prefix='/api')

    ensure_upload_folder(app)
    return app


def ensure_upload_folder(app):
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])
