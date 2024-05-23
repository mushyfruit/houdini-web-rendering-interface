import os
import logging


def get_logger(file_name, level=logging.INFO):
    logger = logging.getLogger(__name__)
    logger.setLevel(level)

    root_folder = os.path.abspath(
        os.path.join(__file__, os.path.pardir, os.path.pardir, os.path.pardir))
    log_dir = os.path.join(root_folder, "logs")

    log_file_path = os.path.join(log_dir, "{0}.log".format(file_name))
    file_handler = logging.FileHandler(log_file_path)
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger
