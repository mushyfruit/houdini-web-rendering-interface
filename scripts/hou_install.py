import os
import shutil
import hashlib
import logging
import tarfile
import argparse
import requests

from tqdm import tqdm
from dotenv import load_dotenv

import sidefx

logging.basicConfig(level=logging.INFO)

DEFAULT_DL_FOLDER = "hou_download"
MIN_HOUDINI = 20.0


def valid_version(version):
    """Validate that the version downloaded supports Python3.9.

    Currently, the Dockerfile.houdini and all other setup are targeting Houdini releases
    that are built against python 3.9.
    """
    try:
        version_num = float(version)
    except ValueError:
        raise argparse.ArgumentTypeError("Invalid version number: {0}".format(str(version)))

    if version_num < MIN_HOUDINI:
        raise argparse.ArgumentTypeError("Version must be {0} or higher.".format(MIN_HOUDINI))
    return version_num


def parse_args():
    parser = argparse.ArgumentParser(add_help=True)

    # Option Arguments
    parser.add_argument('-x',
                        dest="clear_downloads",
                        action='store_true',
                        help='Indicate whether to clear previous downloads.')

    parser.add_argument('-k',
                        dest="keep_tar",
                        action='store_true',
                        help='Indicate whether to keep .tar.gz file after extracting.')

    parser.add_argument('-p',
                        dest="product",
                        action='store',
                        type=str,
                        help='Indicate which product to download.')

    parser.add_argument('version',
                        help="Version of Houdini to download (>=19.5)",
                        type=valid_version)

    return parser.parse_args()


def fetch_or_resume(response, dl_location):
    with open(dl_location, 'ab') as f:
        response.raw.decode_content = True
        total_size = int(response.headers.get('Content-Length', 0))
        block_size = 16384
        progress_bar = tqdm(
            total=total_size, unit='KB',
            unit_scale=True, desc="Downloading"
        )
        for chunk in response.iter_content(block_size):
            progress_bar.update(len(chunk))
            f.write(chunk)
    progress_bar.close()


def download_houdini(service, args):
    """Retrieve the latest build and download.

    latest_release = {
        "download_url": "url_string",
        "filename": "filename_string",
        "hash": "hash_string"
    }

    """
    hou_response = service.download.get_daily_build_download(
        product=args.product or 'houdini-py39',
        version=str(args.version),
        build='production',
        platform='linux'
    )
    if not isinstance(hou_response, dict):
        logging.error(hou_response)
        return

    filename = hou_response['filename']
    if os.environ.get("DOCKER_DL"):
        dl_location = get_houdini_write_path(filename)
    else:
        download_folder = os.path.join(os.getcwd(), DEFAULT_DL_FOLDER)
        if os.path.exists(download_folder) and args.clear_downloads:
            shutil.rmtree(download_folder)
        if not os.path.exists(download_folder):
            os.makedirs(download_folder)
        dl_location = os.path.join(download_folder, filename)

    if os.path.exists(dl_location):
        resume_header = {'Range': 'bytes=%d-' % os.path.getsize(dl_location)}
    else:
        resume_header = {}

    response = requests.get(hou_response['download_url'],
                            headers=resume_header, stream=True)
    if response.status_code == 200 or response.status_code == 206:
        fetch_or_resume(response, dl_location)
    elif response.status_code == 416:
        logging.warning("Invalid byte range in header. "
                        "Is the .tar.gz already downloaded?")
        extract = input("\nDo you wish to continue extracting the previously downloaded file? (y/n): ")
        if extract != 'y':
            return
        return dl_location, hou_response
    else:
        logging.info(response.status_code)
        raise Exception("Unable to download Houdini at"
                        f"{response['download_url']}")
    return dl_location, hou_response


def verify_checksum(download_location, checksum):
    file_hash = hashlib.md5()
    with open(download_location, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            file_hash.update(chunk)
    if file_hash.hexdigest() != checksum:
        raise Exception('Checksum not verified.')
    logging.info("Verified the checksum successfully.")


def extract_houdini_tar(download_location, args):
    with tarfile.open(download_location, "r:gz") as tar:
        tar.extractall(path=os.path.dirname(download_location))
        top_level_dir = tar.getnames()[0]

    if os.environ.get("DOCKER_DL") or not args.keep_tar:
        os.remove(download_location)

    parent_dir = os.path.dirname(download_location)
    extract_path = os.path.join(parent_dir, top_level_dir)
    new_path = os.path.join(parent_dir, "build")

    # Delete and replace existing build directory (if exists)
    # Used when downloading files locally.
    ensure_empty_dir(new_path)

    os.rename(extract_path, new_path)
    logging.info(f"Extracted houdini tar file from `{extract_path}` to `{new_path}`")


def ensure_empty_dir(directory):
    if os.path.exists(directory):
        shutil.rmtree(directory)
    os.makedirs(directory)


def get_houdini_write_path(filename):
    parent_directory = os.path.dirname(os.getcwd())
    return os.path.join(parent_directory, "houdini", filename)


if __name__ == '__main__':
    args = parse_args()

    # Grab env vars from .env
    load_dotenv()

    # Set in the .env file with your API credentials.
    client_id = os.environ.get("SIDEFX_CLIENT")
    client_secret = os.environ.get("SIDEFX_SECRET")

    service = sidefx.service(
        access_token_url="https://www.sidefx.com/oauth2/application_token",
        client_id=client_id,
        client_secret_key=client_secret,
        endpoint_url="https://www.sidefx.com/api/",
    )

    download_response = download_houdini(service, args)
    if download_response:
        download_location, hou_response = download_response
        verify_checksum(download_location, hou_response["hash"])
        extract_houdini_tar(download_location, args)
    else:
        logging.error("Errors were encountered when attempting "
                      "to download Houdini.")
