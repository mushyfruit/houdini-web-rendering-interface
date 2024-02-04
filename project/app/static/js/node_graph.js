
let poppers = {};
const appState = {
    activeNode: null,
    socket: null,
    defaultStart: null,
    defaultEnd: null,
    defaultStep: 1,
    sessionId: null
}

class NodeState {
    constructor() {
        this.lastCooked = null;
        this.thumbnail = null;
        this.has_cooked = false;
        this.startFrame = null;
        this.endFrame = null;
        this.stepFrame = null;
    }
}
class NodeManager {
    constructor() {
        this.renders = new Map();
        this.latestFilename = null;

        // Track the context and file UUID
        this.latestFileUUID = null;
        this.latestFileContext = null;

        // Cache mapping node_path to node states.
        // Poppers are ephemeral, so store the relevant data fields here.
        this.nodeStateCache = new Map();
    }

    addRender(nodePath, renderedFilename) {
        this.renders.set(nodePath, renderedFilename)
        this.latestFilename = renderedFilename;
    }

    setFileUUID(fileUUID) {
        this.latestFileUUID = fileUUID;
        if (this.poppersCache) {
            this.poppersCache.clear();
        }
    }

    updateContext(nodeContext) {
        this.latestFileContext = nodeContext;
    }

    updateNodeStateCache(nodePath, key, value) {
        let nodeState;

        if (this.nodeStateCache.has(nodePath)) {
            nodeState = this.nodeStateCache.get(nodePath);
        } else {
            nodeState = new NodeState();
        }

        if (key in nodeState) {
                nodeState[key] = value;
                this.nodeStateCache.set(nodePath, nodeState);
            } else {
                console.error(`Invalid node state update for ${key} : ${value}`);
        }
    }

    getNodeStateCache(nodePath) {
        return this.nodeStateCache.get(nodePath);
    }

    getRender(nodePath) {
        return this.renders.get(nodePath);
    }

    getLatestRender() {
        return this.latestFilename;
    }

    getLastestContext() {
        return this.latestFileContext;
    }

    getLatestUUID() {
        return this.latestFileUUID;
    }
}

const nodeGraphManager = new NodeManager();

function initNodeGraph(file_uuid, default_context = "/obj") {
    // Delete any lingering poppers from last session.
    deletePoppers();

    // Empty container to populate with Houdini Data.
    var cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        style: [{
            selector: 'node',
            style: {
                'height': 8,
                'width': 25,
                'shape': 'round-rectangle',
                'label': 'data(id)',
                'text-valign': 'center',
                'font-size': '8',
                'text-halign': 'right',
                'text-margin-x': 2,
                'background-image': function (ele) {
                    return ele.data('icon');
                },
                'background-color': function (ele) {
                    return ele.data('color');
                },
                'background-width': 6,
                'background-height': 6,
                'background-fit': 'none',
            },
        },
        {
            selector: 'edge',
            style: {
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'width': '1',
            }
        }
        ],
        layout: {
            name: 'dagre'
        }
    });

    updateGraph(file_uuid, default_context).then(node_data => {
        // Store the default playback range upon initial load.
        appState.defaultStart = node_data.start
        appState.defaultEnd = node_data.end
        if (!appState.sessionId && node_data.session_id) {
            appState.sessionId = node_data.session_id
        }

        cy.add(node_data.elements);
        cy.layout({ name: 'dagre' }).run();
        generateContextButtons(cy, default_context, node_data.parent_icons);
        setupPoppers(cy, node_data.category);
        setupDblClick(cy)

        // Store the current context for later retrieval.
        nodeGraphManager.updateContext(default_context);
    }).catch(error => {
        console.error("Error processing graph update: ", error);
    })
}

function setupDblClick(cy) {
    cy.on("dblclick", "node", function handleDblClick(event) {
        const node = event.target
        if (!node.data().can_enter) {
            return;
        }

        const node_name = node.data("path");
        updateGraph(undefined, node_name).then(node_data => {
            cy.elements().remove();

            // When shifting contexts, remove the previously stored poppers.
            deletePoppers();

            // Update the context chevron buttons.
            generateContextButtons(cy, node_name, node_data.parent_icons);

            cy.add(node_data.elements);
            cy.layout({ name: 'dagre' }).run();

            // Store the current context for later retrieval.
            nodeGraphManager.updateContext(node_name);

            //setupPoppers(cy, node_data.category);
        }).catch(error => {
            console.error("Error processing graph update: ", error);
        })
    })
}

function setupPoppers(cy, nodeTypeCategory) {
    cy.on("click", "node", (event) => {
        const node = event.target

        if (appState.activeNode && appState.activeNode !== node) {
            removePopper(appState.activeNode);
        }

        if (appState.activeNode && appState.activeNode == node) {
            const popperId = `${node.id()}_popper`;
            const popperDiv = document.getElementById(popperId);
            if (popperDiv.hasAttribute("data-show")) {
                popperDiv.removeAttribute("data-show");
            } else {
                popperDiv.setAttribute("data-show", "true");
            }
        }

        if (!appState.activeNode || appState.activeNode !== node) {
            appState.activeNode = node;
            createPopperForNode(cy, node);
        }
    })
}

function deletePoppers() {
    for (const popperId in poppers) {
        const popper = poppers[popperId];

        if (popper) {
            popper.destroy();
        }

        const popperElement = document.getElementById(popperId);
        if (popperElement && popperElement.parentNode) {
            popperElement.parentNode.removeChild(popperElement);
        }

        delete poppers[popperId];
    }
}

function createPopperForNode(cy, node) {
    const popperId = `${node.id()}_popper`;
    if (poppers[popperId]) {
        poppers[popperId].setOptions(options => ({
            ...options,
            modifiers: [
                ...options.modifiers,
                { name: 'eventListeners', enabled: true }
            ]
        }));
        poppers[popperId].update();
        const popperElement = document.getElementById(popperId);
        if (popperElement) {
            popperElement.setAttribute("data-show", "true");
        }
        return
    }

    const popperInstance = node.popper({
        content: () => buildPopperDiv(node),
        popper: {
            placement: 'top',
            modifiers: [{ name: 'offset', options: { offset: [0, 8] } }],
        }
    });

    popperInstance.update();
    poppers[`${node.id()}_popper`] = popperInstance;

    const update = () => popperInstance.update();
    node.on('position', update);
    cy.on('pan zoom resize', update);
}

function removePopper(node) {
    const popperId = `${node.id()}_popper`;
    if (poppers[popperId]) {
        poppers[popperId].setOptions(options => ({
            ...options,
            modifiers: [
                ...options.modifiers,
                { name: 'eventListeners', enabled: false }
            ]
        }));
    }
    const popperElement = document.getElementById(popperId);
    if (popperElement) {
        popperElement.removeAttribute("data-show")
    }

}

function generateContextButtons(cy, full_context, parent_icons) {
    const contexts = full_context.split('/');
    const filteredContexts = contexts.filter(context => context !== '');

    // Clear on context refresh.
    const container = document.getElementById('button-container');
    if (container.children.length > 0) {
        container.innerHTML = '';
    }

    // Accumulate path per button as we iterate.
    let runningPath = '';
    filteredContexts.forEach((context, index) => {
        runningPath += '/' + context;
        const button = document.createElement('button');
        button.classList.add('context-button')
        button.textContent = context;
        button.setAttribute('nodeFullPath', runningPath);

        if (index === 0) {
            button.setAttribute('isRoot', 'true');
        } else {
            const additionalShift = 9 * index;
            button.style.transform = `translateX(${-additionalShift}px)`;
        }

        if (parent_icons[context]) {
            const dataURI = parent_icons[context];
            button.style.backgroundSize = '15px 15px';
            button.style.backgroundRepeat = 'no-repeat';
            button.style.backgroundImage = `url(${dataURI})`;
            if (index === 0) {
                button.style.backgroundPosition = '5px center';
            } else {
                button.style.backgroundPosition = '15px center';
            }

        }

        button.addEventListener('click', function (event) {
            const fullPath = event.target.getAttribute('nodeFullPath');
            updateGraph(undefined, fullPath).then(node_data => {
                cy.elements().remove();
                deletePoppers();
                generateContextButtons(cy, fullPath, node_data.parent_icons);
                cy.add(node_data.elements);
                cy.layout({ name: 'dagre' }).run();
            })
        });

        container.appendChild(button);
    })

    const buttonContainer = document.getElementById('context-display');
    buttonContainer.appendChild(container);
}

function buildPopperDiv(node) {
    // Loader bar is located between geo1 and cook status.
    nodeContext = node.data('path');
    nodeCache = nodeGraphManager.getNodeStateCache(nodeContext);

    nodeName = node.data('id');
    nodeLastCooked = nodeCache?.lastCooked ?? node.data('cooktime');

    nodeStartFrame = nodeCache?.startFrame ?? appState.defaultStart;
    nodeEndFrame = nodeCache?.endFrame ?? appState.defaultEnd;
    nodeStepFrame = nodeCache?.stepFrame ?? appState.defaultStep;

    const html = `
        <div class="card">
            <div class="card-body">
                <div id="node-context-container">
                    <div id="node-context">
                        <p id="popper-node-name">${nodeName}</p>
                        <p id="popper-node-context">${nodeContext}</p>
                    </div>
                </div>
                <div id="node-cook-bar-container">
                    <div id="cooking-status" class="node-status-label">Progress:</div>
                    <div id="cooking-bar" data-node-name="${nodeName}"></div>
                </div>
                <div id="node-status-container">
                    <div id="node-status">
                        <div class="node-status-label">
                            Last Cooked:
                        </div>
                        <div class="node-status-value" id="node-last-cooked" data-node-name="${nodeName}">
                        </div>
                    </div>
                </div>
                <div id="frame-input-container">
                    <label for="start-frame">Start/End/Inc</label>
                    <input type="number" id="start-frame" name="startFrame" min="1" class="frame-input" value="${nodeStartFrame}">

                    <input type="number" id="end-frame" name="endFrame" min="2" class="frame-input" value="${nodeEndFrame}">

                    <input type="number" id="step-frame" name="stepFrame" min="1" class="frame-input" value="${nodeStepFrame}">
                </div>
                <div id="render-button-container">
                    <button id="submitRender" class="render-btn">Submit</button>
                </div>
            </div>
        </div>`;
    const div = document.createElement("div");
    div.id = `${node.id()}_popper`;
    document.body.appendChild(div);
    div.innerHTML = html;

    div.setAttribute('data-show', 'true');
    const nodeStatusValue = div.querySelector("#node-last-cooked");
    nodeStatusValue.textContent = nodeLastCooked || "Uncooked";

    // Allow for CSS to pickup on transition.
    setTimeout(() => {
        div.setAttribute('data-show', 'true');
    }, 20);

    const button = div.querySelector('#submitRender');
    button.addEventListener('click', function () {
        handleSubmit(node);
    });

    const frameInputs = document.querySelectorAll('.frame-input');
    frameInputs.forEach(input => {
        input.addEventListener('input', function(e) {
            const value = e.target.value;
            const frameInputName = e.target.name;
            nodeGraphManager.updateNodeStateCache(
                nodeContext, frameInputName, value
            );
        })
    })

    if (nodeCache?.has_cooked ?? false) {
        let bar = div.querySelector('#cooking-bar');
        bar.style.width = '100%';
    }

    return div;
}

function initSocket(node) {
    if (!appState.socket) {
        appState.socket = io();
        registerEventListeners();
    }
}

function registerEventListeners() {
    appState.socket.on('node_render_progress_channel', handleRenderUpdate);
    appState.socket.on('node_thumb_progress_channel', handleThumbUpdate);
    appState.socket.on('node_thumb_finish_channel', handleThumbFinish);
    appState.socket.on('node_render_finish_channel', handleRenderFinish);
}

function handleRenderUpdate(data) {
    let nodeName = data.nodeName;
    let progress = data.progress;
    let bar = document.querySelector(`#cooking-bar[data-node-name="${nodeName}"]`);
    if (bar) {
        bar.style.width = progress + '%';
    }
}

function handleThumbUpdate(data) {
    // Pass data to the rendered "page"
    // Just pass the data there.
    // Update underlying data structure?
    console.log("THUMB")
    console.log(data);
}

function handleThumbFinish(data) {
    nodeGraphManager.updateNodeStateCache(nodePath, "thumbnail", data.filename);
}

function handleRenderFinish(data) {
    nodePath = data.nodepath;
    nodeGraphManager.addRender(nodePath, data.filename);
    nodeGraphManager.updateNodeStateCache(nodePath, "has_cooked", true);
    handlePostRender(nodePath);
}

function startRenderTask(node) {
    const startFrameInput = document.getElementById('start-frame');
    const endFrameInput = document.getElementById('end-frame');
    const stepFrameInput = document.getElementById('step-frame');

    const start = parseInt(startFrameInput.value, 10);
    const end = parseInt(endFrameInput.value, 10);
    const step = parseInt(stepFrameInput.value, 10);

    // Validate render settings here:
    if (!validateSubmission(start, end, step)) {
        return;
    }

    const nodePath = node.data('path');

    // Emit the render task event.
    appState.socket.timeout(5000).emit(
        'submit_render_task',
        { 'start': start, 'end': end, 'step': step, 'path': nodePath },
        (err, response) => {
            if (err) {
                // Server doesn't acknowledge event within timeout.
                console.error("Server didn't acknowledge render event.");
            } else {
                render_status = response.success
                if (!render_status) {
                    // TODO Display to user that submission failed.
                    console.error(response.message);
                    return;
                }

                // TODO Display successful submission
                console.log(response.message);
            }
        }
    )
}


function validateSubmission(start, end, step) {
    if (start >= end) {
        console.error("Start frame must be less than end frame.");
        return false;
    }

    if (step <= 0) {
        console.error("Step must be greater than 0.");
        return false;
    }

    if (!appState.socket) {
        console.error("WebSocket has not been initialized!");
        return false;
    }

    return true;
}


function handleSubmit(node) {
    initSocket();
    startRenderTask(node);
}

function getCurrentFormattedTime() {
    const now = new Date();
    let hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const amPm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;

    return `${hours}:${minutes}:${seconds} ${amPm}`;
}

function handlePostRender(nodePath) {
    // Update the Last Cooked to include time data.
    let segments = nodePath.split("/");
    let nodeName = segments[segments.length - 1];
    const last_cooked = document.querySelector(`.node-status-value[data-node-name="${nodeName}"]`);
    if (last_cooked) {
        const cook_time = getCurrentFormattedTime();
        nodeGraphManager.updateNodeStateCache(nodePath, "lastCooked", cook_time)
        last_cooked.textContent = cook_time;
    }
}

async function updateGraph(file_uuid = globalFileUuid, node_name) {
    if (!file_uuid) {
        throw new Error("Please pass a .hip UUID.");
    }
    if (!node_name) {
        throw new Error("Node name is required.");
    }

    try {
        globalFileUuid = file_uuid;

        const response = await fetch(`/node_data?uuid=${file_uuid}&name=${node_name}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching node data: ", error);
    }
}
