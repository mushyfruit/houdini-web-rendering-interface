# Houdini Web Rendering Interface

This project combines a dockerized implementation of Houdini with a user-friendly web interface.
The Houdini web-app is designed to interact with a HIP file's node graph, execute renders, and preview scene geometry
from your web browser.

## Features

- **Dockerized Houdini**: Simplified setup and deployment using Docker containers.
- **Network Access**: Interact with uploaded HIP files from any device on your local network
- **Web Interface**: Interact with Houdini’s node graph, execute renders, and preview scenes from the web.
- **File Sharing**: Quickly generate shareable links for HIP files and rendered models.

# Getting Started

### Prerequisites

Ensure you have the following installed on your system first:

- [Docker](https://docs.docker.com/get-docker/), a platform for developing and shipping applications.

## Quick Start Guide

1. **Generate SideFX API Credentials:**
    - Generate a "Client ID" and "Client Secret" following
      these [steps](https://www.sidefx.com/docs/api/credentials/index.html).
    - These variables will be used
      for [login licensing](https://www.sidefx.com/docs/houdini/ref/utils/hkey.html#api_key_licensing), allowing you to
      use Houdini without needing to log in manually.
2. **Create an `.env` file**:
    - In the project root directory, create a .env file with the following keys:
    <br>
    
    ```env
    SIDEFX_CLIENT="YOUR_CLIENT_ID_HERE"
    SIDEFX_SECRET="YOUR_SECRET_HERE"
    HFS_VER="20.0"
    ```
   - If you're targeting a specific Houdini version, specify that with the `HFS_VER` variable.
3. **(Optional) Add GPU Support**:
   - To enable GPU support for the dockerized Houdini, you need to install the NVIDIA Container Toolkit. 
   - [Nvidia GPU Support](#nvidia-gpu-support) (Only supported on Linux)


4. **Build and Run the Application**:
    - Once you've download Docker and setup your account, run `docker compose up --build` to build the app's docker
      images.
    - If you encounter the following issue when building: `Error getting credentials`, you may need to
      run `docker login`.
5. **Access the Houdini Web Server**:
    - Once the containers are running, you can access the Houdini Web Server from any device on your local network.
    - Open your web browser and navigate to http://localhost or use
      your [local IP address](https://www.whatismybrowser.com/detect/what-is-my-local-ip-address).

## Nvidia GPU Support
-  Ensure you have the latest NVIDIA driver installed from the [NVIDIA website](https://www.nvidia.com/Download/index.aspx).
    - No support for [OpenCL and WSL2](https://github.com/microsoft/WSL/issues/6951), only working for Linux.
- Install the NVIDIA Container Toolkit using the following [instructions](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
- Verify the installation:
  ```shell
  docker run --rm --gpus all nvidia/cuda:11.0.3-base nvidia-smi
  ```
  You should see a printout of your GPU information.


## Troubleshooting

- **Docker Issues**: Ensure Docker is installed correctly and running.
    - If you're not using Docker Desktop, you may have
      to [install Docker Compose](https://docs.docker.com/compose/install/) manually.
- **Network Access**: Verify that your device is connected to the same local network.
- **Container Logs**: Check the container logs for any error messages by running: `docker compose logs`
- **OpenCL Issues**: If you do not intend to use OpenCL in the container, remove lines 57-63 in `compose.yaml`.

## Downloading Houdini Separately

As part of the building the Houdini docker image, the latest Python3.9 build of Houdini will
automatically be installed. However, if you'd like to accelerate the build process. you can download Houdini beforehand
and point the Docker file to your install (located within the project root.)

1. Run the `hou_install.py` script:
    - From the project root run:
        - `python3 ./scripts/hou_install.py 20.0`
    - This will install and unpack Houdini to a folder titled `hou_download`.
    - The script automatically targets the Python3.9 build of the specified Houdini verison.
2. (Optional) Update the `HOU_INSTALL_LOCATION` argument:
    - Update the `HOU_INSTALL_LOCATION` argument in `compose.yaml` to point to your Houdini download.
    - By default, it points to `hou_download` and shouldn't require changes.
3. Start the Docker Build process:
    - When you start the Docker build process, the unpacked Houdini install will be copied over.

## Contributing

Contributions are welcome! Please fork the repository and submit a
pull request for any improvements or bug fixes.
