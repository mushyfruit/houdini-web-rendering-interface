
function initializeStoredModels(storedModels) {
    const defaultWidth = '256px';
    const activeWidth = '92px';
    const fileUploadWidth = '385px';

    const sidebar = document.querySelector('.sidebar');
    let finalValue = sidebar.classList.contains('active') ? activeWidth : defaultWidth;
    finalValue = sidebar.classList.contains('file-upload') ? fileUploadWidth : finalValue;
    storedModels.style.marginLeft = finalValue;
    document.documentElement.style.setProperty('--dynamic-margin-left', finalValue);
}


function handleStoredModelsToggle(storedModels, sidebar, toggled_button) {

    // Set transition based on sidebar's current transition time.
    const style = window.getComputedStyle(sidebar);
    storedModels.style.transition = style.transitionDuration;

    const defaultWidth = '256px';
    const activeWidth = '92px';
    const fileUploadWidth = '385px';

    let finalValue = sidebar.classList.contains('active') ? activeWidth : defaultWidth;
    if (toggled_button) {
        if (sidebar.classList.contains('file-upload')) {
            setTimeout(() => {
                finalValue = sidebar.classList.contains('file-upload') ? `${finalValue}` : '385px';
                storedModels.style.marginLeft = finalValue;
                document.documentElement.style.setProperty('--dynamic-margin-left', finalValue);
            }, 350);
            return;
        } else {
            finalValue = fileUploadWidth;
        }
    } else {
        finalValue = sidebar.classList.contains('active') ? activeWidth : defaultWidth;
    }
    storedModels.style.marginLeft = finalValue;
    document.documentElement.style.setProperty('--dynamic-margin-left', finalValue);
}

async function handleStoredModels() {
    onNodeGraphExit();

    var canvas = document.getElementById('renderCanvas');
    if (canvas && canvas.style.display != 'none') {
        hideRenderCanvas();
    }

    // Clear the node graph and prepare to show stored models page.
    document.querySelector('.main-body').innerHTML = '';

    try {
        const response = await fetch('stored_models');
        if (!response.ok) {
            throw new Error('Failed to load the stored models...');
        }
        const htmlContent = await response.text();

        const storedModelsDiv = document.createElement('div');
        storedModelsDiv.className = 'stored-models';
        storedModelsDiv.innerHTML = htmlContent;
        initializeStoredModels(storedModelsDiv);

        document.querySelector('.main-body').appendChild(storedModelsDiv);

    } catch (error) {
        document.querySelector('.status-message').innerText = error.message;
    }

    const userUuid = localStorage.getItem("userUuid");
    if (userUuid !== null) {
        console.log("The user UUID is:", userUuid);

        try {
            const response = await fetch(`get_stored_models?userUuid=${encodeURIComponent(userUuid)}`);

            if (!response.ok) {
                throw new Error(`Failed to load the node graph, status: ${response.status}`);
            }
            const data = await response.json();
            populateFiles(data.model_data);

        } catch (error) {
            console.error("Error fetching stored models:", error.message);
        }
    } else {
        console.log("No user UUID found in localStorage.");
    }
}


function populateFiles(files) {
    if (!Array.isArray(files)) {
        console.error('Invalid input: expected an array, got', typeof files);
        return;
    }

    const cachedMetadata = localStorage.getItem("stored-model-metadata");
    const metadata = cachedMetadata ? JSON.parse(cachedMetadata) : {};

    const container = document.getElementById('models-container');
    container.innerHTML = '';

    files.forEach(file => {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'model-content';
        contentDiv.id = `model-${file.file_uuid}`;

        container.appendChild(contentDiv);
        if (file.glb) {
            Object.entries(file.glb).forEach(([key, value]) => {
                console.log(value);
                if (!metadata[key] || metadata[key] != value) {
                    const thumbCard = document.createElement('div');
                    thumbCard.className = 'thumb-card';
                    thumbCard.id = `thumb-card-${key}`;

                    let thumbUrl = '';
                    if (file.thumb && file.thumb[key]) {
                        const img = createThumbnail(file.thumb[key], key);
                        thumbCard.appendChild(img);
                    } else {
                        const loadingHolder = document.createElement('div');
                        loadingHolder.className = 'animation-holder';
                        loadingHolder.setAttribute('data-node-path', key);

                        const loadingIndicator = document.createElement('div');
                        loadingIndicator.className = 'loader_animation';

                        loadingHolder.appendChild(loadingIndicator);
                        thumbCard.appendChild(loadingHolder);
                    }


                    const cardBody = document.createElement('div');
                    cardBody.className = 'model-card-body';

                    const cardTitle = document.createElement('h6');
                    cardTitle.className = 'card-title'
                    cardTitle.innerText = key;

                    const cardText = document.createElement('p');
                    cardText.innerText = "lorem ipsum";
                    cardText.className = 'card-text'

                    cardBody.appendChild(cardTitle);
                    cardBody.appendChild(cardText);
                    thumbCard.appendChild(cardBody);
                    contentDiv.appendChild(thumbCard);

                    metadata[key] = {
                        imgUrl: thumbUrl,
                        title: key,
                        text: "Lorem ipsum",
                        glb: file.glb[key]
                    };
                }
            });
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'stored-model-info'
        contentDiv.appendChild(infoDiv);
    });

    localStorage.setItem("stored-model-metadata", JSON.stringify(metadata));
}

function createThumbnail(thumb_name, nodePath) {
    thumbUrl = `/get_thumbnail/${thumb_name}`;

    const img = document.createElement('img');
    img.src = thumbUrl;
    img.className = 'model-img'
    img.id = `thumb-card-img-${nodePath}`;
    img.style.display = 'block';

    img.addEventListener('click', function() {
        const key = this.id.split('thumb-card-img-')[1];

        const cachedMetadata = localStorage.getItem("stored-model-metadata");
        const metadata = cachedMetadata ? JSON.parse(cachedMetadata) : {};

        const data = metadata[key];
        handleDisplayModel(data.glb);
        nodeGraphManager.updateLatestRender(data.glb);
    });

    return img
}