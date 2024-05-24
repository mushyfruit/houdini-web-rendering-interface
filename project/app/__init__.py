import os
from flask import Flask
from flask_socketio import SocketIO
from flask_session import Session
from flask_wtf.csrf import CSRFProtect

from celery import Celery, Task
from config import Config

socketio = SocketIO()
sess = Session()
csrf = CSRFProtect()


def celery_init_app(app):

    class FlaskTask(Task):

        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    # Can't intialize with TaskCls argument else it raises:
    # AttributeError: Can't pickle local object 'celery_init_app.<locals>.FlaskTask'
    # Instead setting it after initializing class seems to work fine?
    celery_app = Celery(app.name)
    celery_app.config_from_object(app.config["CELERY"])
    celery_app.Task = FlaskTask
    celery_app.set_default()
    app.extensions["celery"] = celery_app
    return celery_app


def create_app(config_class=Config):
    app = Flask(__name__)

    # Initialize from Config and environment.
    app.config.from_object(config_class)
    app.config.from_prefixed_env()

    # Override the app's static folder value.
    app.static_folder = app.config.get('STATIC_FOLDER')

    csrf.init_app(app)

    sess.init_app(app)

    socketio.init_app(app, async_mode='eventlet')

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
