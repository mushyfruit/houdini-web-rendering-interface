document.addEventListener('DOMContentLoaded', (event) => {
    getUserID();
    connectFileInput();
    toggleSidebar();
    setupSidebar();
    connectHIP();
});

function getUserID() {
    let userUuid = localStorage.getItem("userUuid");
    if (!userUuid) {
        fetch('generate_user_uuid')
            .then(response => {
                if (!response.ok) throw new Error('Failed to generate new UUID');
                return response.json();
            })
            .then(data => {
                userUuid = data.user_uuid;
                localStorage.setItem("userUuid", userUuid);
                console.log("New user UUID generated and stored:", userUuid)
            })
            .catch(error => console.error("Error generating UUID:", error));
    } else {
        console.log("Found existing UUID for the user:", userUuid);
        fetch('set_existing_user_uuid', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userUuid: userUuid })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to set existing UUID');
            return response.json();
        })
        .then(data => console.log('Success:', data))
        .catch(error => console.error('Error setting UUID on server:', error));
    }
}


async function connectHIP() {
    const uploadForm = document.querySelector('.uploadForm')
    uploadForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        let formData = new FormData(this);

        try {
            const response = await fetch('hip_upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Upload failed...');
            }

            const data = await response.json();
            nodeGraphManager.setFileUUID(data.uuid);
            await fetch_node_graph(data.uuid);
        } catch (error) {
            document.querySelector('.status-message').innerText = error.message;
        }
    })
}

function hideRenderCanvas() {
    var canvas = document.getElementById('renderCanvas');
    if (canvas) {
        canvas.style.zIndex = -1;
        canvas.style.display = 'none';
    }
    stopRenderLoop();
}

function showRenderCanvas() {
    var canvas = document.getElementById('renderCanvas');
    if (canvas && canvas.style.display === 'none') {
        canvas.style.display = 'block';
        canvas.style.zIndex = 1;
        startRenderLoop();
    }
}

async function fetch_node_graph(file_uuid, default_context="/obj") {
    try {
        const response = await fetch('node_graph');
        if (!response.ok) {
            throw new Error('Failed to load the node graph...');
        }

        const htmlContent = await response.text();
        hideRenderCanvas();
        document.querySelector('.main-body').innerHTML = htmlContent;
        initNodeGraph(file_uuid, default_context);
    } catch (error) {
        document.querySelector('.status-message').innerText = error.message;
    }
}

function connectFileInput() {
    const fileInput = document.querySelector('.file-input')
    const fileNameDisplay = document.querySelector('.file-name-display')

    fileNameDisplay.addEventListener('click', function(e) {
        fileInput.click();
    });

    fileInput.addEventListener('change', function() {
        let fileName = this.files[0].name;
        fileNameDisplay.value = fileName;
    })
}

function toggleSidebar() {
    const menuBtn = document.querySelector('.menu-btn');
    const sidebar = document.querySelector('.sidebar');
    const uploadContainer = document.querySelector('.wrapped-container')

    menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        if (sidebar.classList.contains('file-upload')) {
            sidebar.classList.remove('file-upload')
            slideToggle(uploadContainer)
        }

        if (!sidebar.classList.contains('file-upload') && (sidebar.classList.contains('active'))) {
            sidebar.style.transitionDuration = '0.5s';
        }
        const transitionEnded = function() {
            sidebar.removeEventListener('transitionend', transitionEnded)
            sidebar.style.transitionDuration = '';
        }
    
        sidebar.addEventListener('transitionend', transitionEnded);
    })
}

async function handleStoredModels() {
    onNodeGraphExit();

    var canvas = document.getElementById('renderCanvas');
    if (canvas && canvas.style.display != 'none') {
        hideRenderCanvas();
    }

    const userUuid = localStorage.getItem("userUuid");
    if (userUuid !== null) {
        console.log("The user UUID is:", userUuid);

        try {
            const response = await fetch(`stored_models?userUuid=${encodeURIComponent(userUuid)}`);

            if (!response.ok) {
                throw new Error(`Failed to load the node graph, status: ${response.status}`);
            }
            const data = await response.json();
            console.log("Stored model data:", data);
        } catch (error) {
            console.error("Error fetching node graph:", error.message);
        }
    } else {
        console.log("No user UUID found in localStorage.");
    }

    // Show the stored models page.
    document.querySelector('.main-body').innerHTML = '';
}



async function handleNodeGraph() {
    // Hide the BabylonJS canvas if needed.
    var canvas = document.getElementById('renderCanvas');
    if (canvas && canvas.style.display != 'none') {
        hideRenderCanvas();
    }

    // Latest upload UUID is stored upon upload.
    let latestResponse = nodeGraphManager.getLatestUUID();
    if (latestResponse) {
        let latest_context = nodeGraphManager.getLatestContext();
        if (!latest_context) {
            latest_context = "/obj"
        }
        await fetch_node_graph(latestResponse, latest_context);
    }
}

function onNodeGraphExit() {
    let cy = document.getElementById('cy');
    if (cy) {
        const oldContext = nodeGraphManager.getLatestContext();
        nodeGraphManager.updateViewStateCache(oldContext, window.getCyZoom(), window.getCyPan());
    }
    deletePoppers();
}

function handleDisplayModel() {
    // Remove any lingering popper elements.
    onNodeGraphExit();

    // Restart the render loop and unhide the render canvas.
    showRenderCanvas();

    // Reset the main-body element to clear up space for renderCanvas.
    document.querySelector('.main-body').innerHTML = '';

    // Grab the latest render.
    latest_filename = nodeGraphManager.getLatestRender();
    if (latest_filename) {
        loadModel(latest_filename);
    } else {
        // Fallback to a default model?
        loadModel("placeholder.glb");
    }
}

function setupSidebar() {
    const sidebar = document.querySelector('.sidebar')
    const menuItems = document.querySelectorAll('.menu > ul > li')
    menuItems.forEach((menuItem) => {
        menuItem.addEventListener('click', function(e) {
            removeClassFromElements(getSiblings(this), 'active');
            toggleClass(this, 'active');

            getSiblings(this).forEach((sibling) => {
                let siblingUl = sibling.querySelector('ul');
                if (siblingUl) {
                    removeClassFromElements(siblingUl.querySelectorAll('li'), 'active');
                }})
            
            let submenu = this.querySelector('ul.sub-menu');
            if (submenu) {
                slideToggle(submenu);
            }
        })
    })

    const displayModel = document.getElementById('display-model');
    displayModel.addEventListener('click', (e) => {
        handleDisplayModel();
    });

    const nodeGraph = document.getElementById('node-graph');
    nodeGraph.addEventListener('click', (e) => {
        handleNodeGraph().catch(error => {
            console.error("Failed to handle the Node Graph:", error);
        });
    });

    const storedModels = document.getElementById('stored-models');
    storedModels.addEventListener('click', (e) => {
        handleStoredModels().catch(error => {
            console.error("Failed to handle the Stored Model:", error);
        })
    });

    const hipUploader = document.querySelector('.hip-upload')
    hipUploader.addEventListener('click', function(e) {
        if (!sidebar.classList.contains('file-upload') && (sidebar.classList.contains('active'))) {
            sidebar.style.transitionDuration = '0.5s';
        }

        if (sidebar.classList.contains('active')) {
            sidebar.classList.toggle('active')
        }

        const transitionEnded = function() {
            sidebar.removeEventListener('transitionend', transitionEnded)
            sidebar.style.transitionDuration = '';
        }

        sidebar.addEventListener('transitionend', transitionEnded);
        let uploadContainer = document.querySelector('.wrapped-container')
        if (sidebar.classList.contains('file-upload')) {
            slideToggle(uploadContainer)
            setTimeout(function() {
                sidebar.classList.toggle('file-upload');
            }, 350);
        } else {
            sidebar.classList.toggle('file-upload')
            sidebar.addEventListener('transitionend', function onTransitionEnd(event) {
                // Make sure we're listening for the end of the correct transition, e.g., width
                if (event.propertyName === 'width') {
                    slideToggle(uploadContainer);
        
                    // Remove this event listener so it only runs once
                    sidebar.removeEventListener('transitionend', onTransitionEnd);
                }
            });
        }
    })

}

function slideToggle(element) {
    if(!element.classList.contains('toggled')) {
        element.classList.add('toggled')
        element.style.height = '';
        element.offsetHeight;

        let height = element.clientHeight + "px"
        element.style.height = "0px"
        setTimeout(() => {
            element.style.height = height;
        }, 0)

    } else {
        element.style.height = "0px";
        element.addEventListener('transitionend', () => {
            element.classList.remove('toggled');
        }, {once: true})
    }
};

function getSiblings(elem) {
    var sibling = elem.parentNode.firstChild;
    var siblings = [];
    while (sibling) {
        if (sibling.nodeType == 1 && sibling !== elem) {
            siblings.push(sibling);
        }
        sibling = sibling.nextSibling;
    }
    return siblings;

}

function removeClassFromElements(elements, className) {
    elements.forEach((element) => {
        element.classList.remove(className)
    })
}

function toggleClass(element, className) {
    element.classList.toggle(className)
}