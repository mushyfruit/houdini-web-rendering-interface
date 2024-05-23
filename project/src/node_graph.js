import { cytoscape, io } from './main';
import { createThumbnail } from './stored_models.js';
import { DEFAULT_THUMBNAIL_ROUTE } from './constants';

let globalFileUuid = null;
let poppers = {};
const appState = {
	activeNode: null,
	socket: null,
	sessionId: null,
};

class NodeState {
	constructor() {
		this.lastCooked = null;
		this.thumbnail = null;
		this.has_cooked = false;
		this.startFrame = null;
		this.endFrame = null;
	}
}
class NodeManager {
	constructor() {
		this.renders = {};
		this.latestFilename = null;

		// Track the context and file UUID
		this.latestFileUUID = null;
		this.latestFileContext = '/obj';

		// Cache mapping node_path to node states.
		// Poppers are ephemeral, so store the relevant data fields here.
		this.nodeStateCache = new Map();
		this.nodeViewCache = new Map();

		this.fileDefaultStart = 1;
		this.fileDefaultEnd = 240;

		this.globalDefaultStart = null;
		this.globalDefaultEnd = null;
	}

	setFileDefaultStart(startFrame) {
		this.fileDefaultStart = startFrame;
	}

	setFileDefaultEnd(endFrame) {
		this.fileDefaultEnd = endFrame;
	}

	setGlobalDefaultStart(startFrame) {
		this.globalDefaultStart = startFrame;
	}

	setGlobalDefaultEnd(endFrame) {
		this.globalDefaultEnd = endFrame;
	}

	getDefaultStart() {
		// Allow for global override.
		if (!this.globalDefaultStart) {
			return this.fileDefaultStart;
		} else {
			return this.globalDefaultStart;
		}
	}

	getDefaultEnd() {
		// Allow for global override.
		if (!this.globalDefaultEnd) {
			return this.fileDefaultEnd;
		} else {
			return this.globalDefaultEnd;
		}
	}

	addRender(renderedFilename, nodePath, frameRange) {
		this.renders[renderedFilename] = {
			nodePath: nodePath,
			frameRange: frameRange,
		};
		this.latestFilename = renderedFilename;
	}

	updateLatestRender(renderedFilename) {
		this.latestFilename = renderedFilename;
	}

	setFileUUID(fileUUID) {
		this.latestFileUUID = fileUUID;
		if (this.nodeStateCache) {
			this.nodeStateCache.clear();
		}
	}

	updateContext(nodeContext) {
		this.latestFileContext = nodeContext;
	}

	updateViewStateCache(parentContext, zoom, pan) {
		this.nodeViewCache[parentContext] = { zoom, pan };
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

	getRender(fileName) {
		return this.renders[fileName];
	}

	getLatestRender() {
		return this.latestFilename;
	}

	getLatestContext() {
		return this.latestFileContext;
	}

	getLatestUUID() {
		return this.latestFileUUID;
	}
}

const nodeGraphManager = new NodeManager();
export { nodeGraphManager };

export function initNodeGraph(file_uuid, default_context = '/obj') {
	// Delete any lingering poppers from last session.
	deletePoppers();

	// Empty container to populate with Houdini Data.
	var cy = cytoscape({
		container: document.getElementById('cy'),
		elements: [],
		style: [
			{
				selector: 'node',
				style: {
					height: 8,
					width: 25,
					shape: 'round-rectangle',
					label: 'data(id)',
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
					width: '1',
				},
			},
		],
		layout: {
			name: 'dagre',
		},
	});

	cy.on('layoutstop', function () {
		// Store the zoom and pan information per nodeContext.
		// Restore once we've updated the node layout.
		const currentContext = nodeGraphManager.getLatestContext();

		if (currentContext in nodeGraphManager.nodeViewCache) {
			const viewData = nodeGraphManager.nodeViewCache[currentContext];
			if (viewData) {
				cy.zoom(viewData.zoom);
				cy.pan(viewData.pan);
			}
		}
	});

	// Expose methods for retrieving node graph state.
	window.getCyZoom = function () {
		return cy.zoom();
	};
	window.getCyPan = function () {
		return cy.pan();
	};

	updateGraph(cy, default_context, file_uuid, false)
		.then((nodeData) => {
			// Store the default playback range upon initial load.
			nodeGraphManager.setFileDefaultStart(nodeData.start);
			nodeGraphManager.setFileDefaultEnd(nodeData.end);
			if (!appState.sessionId && nodeData.session_id) {
				appState.sessionId = nodeData.session_id;
			}

			setupRenderAllButton();
			displayNodeContext(cy, default_context, nodeData);
			setupPoppers(cy);
			setupDblClick(cy);
		})
		.catch((error) => {
			console.error('Error processing graph update: ', error);
		});
}

export async function restoreNodeGraphState(nanoid) {
	// Retrieve the file uuid.
	try {
		const response = await fetch(
			`get_hip_name_from_nano_id?nanoid=${encodeURIComponent(nanoid)}`,
		);
		if (!response.ok) {
			throw new Error('Hip retrieval failed: ' + response.statusText);
		}
		const data = await response.json();
		nodeGraphManager.setFileUUID(data.hip_uuid);
		console.log(`Setting: ${data.hip_uuid}`);
	} catch (error) {
		console.error('Unable to find an associated hip file for nano id:', error);
	}
}

function displayNodeContext(cy, nodeName, nodeData) {
	handleRenderAllButton(nodeData);
	handleGlobalCookingBar(nodeName);
	generateContextButtons(cy, nodeName, nodeData.parent_icons);
	cy.add(nodeData.elements);
	cy.layout({ name: 'dagre' }).run();
}

function handleGlobalCookingBar(nodeName) {
	const globalCooking = document.querySelector('.global-cooking-bar');
	if (globalCooking) {
		globalCooking.setAttribute('data-node-path', nodeName);
	}
}

function handleRenderAllButton(nodeData) {
	const globalSettingsHolder = document.querySelector('.globalRender');
	if (globalSettingsHolder) {
		if (nodeData.can_cook_all) {
			globalSettingsHolder.style.display = 'block';
		} else {
			globalSettingsHolder.style.display = 'none';
		}
	}
}

function setupRenderAllButton() {
	const renderButton = document.querySelector('#renderAllBtn');
	if (renderButton) {
		renderButton.addEventListener('click', function () {
			const globalCookingBar = document.querySelector('.global-cooking-bar');
			if (globalCookingBar) {
				globalCookingBar.style.width = '0%';
			}
			const currentContext = nodeGraphManager.getLatestContext();
			handleContextSubmission(currentContext);
		});
	}

	const startFrame = document.querySelector('#global-start-frame');
	const endFrame = document.querySelector('#global-end-frame');
	if (startFrame && endFrame) {
		startFrame.value = nodeGraphManager.getDefaultStart();
		endFrame.value = nodeGraphManager.getDefaultEnd();

		startFrame.addEventListener('change', function (e) {
			const newValue = parseInt(e.target.value, 10);
			nodeGraphManager.setGlobalDefaultStart(newValue);
		});

		endFrame.addEventListener('change', function (e) {
			const newValue = parseInt(e.target.value, 10);
			nodeGraphManager.setGlobalDefaultEnd(newValue);
		});
	}
}

function setupDblClick(cy) {
	cy.on('dblclick', 'node', function handleDblClick(event) {
		const node = event.target;
		if (!node.data().can_enter) {
			return;
		}

		const nodeName = node.data('path');
		updateGraph(cy, nodeName)
			.then((node_data) => {
				cy.elements().remove();

				// When shifting contexts, remove the previously stored poppers.
				deletePoppers();
				displayNodeContext(cy, nodeName, node_data);

				//setupPoppers(cy, node_data.category);
			})
			.catch((error) => {
				console.error('Error processing graph update: ', error);
			});
	});
}

function setupPoppers(cy) {
	cy.on('click', 'node', (event) => {
		const node = event.target;

		if (appState.activeNode && appState.activeNode !== node) {
			removePopper(appState.activeNode);
		}

		if (appState.activeNode && appState.activeNode == node) {
			const popperId = `${node.id()}_popper`;
			const popperDiv = document.getElementById(popperId);
			if (popperDiv.hasAttribute('data-show')) {
				hidePopper(popperDiv);
			} else {
				showPopper(popperDiv);
			}
		}

		if (!appState.activeNode || appState.activeNode !== node) {
			appState.activeNode = node;
			createPopperForNode(cy, node);
		}
	});
}

export function deletePoppers() {
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
		poppers[popperId].setOptions((options) => ({
			...options,
			modifiers: [...options.modifiers, { name: 'eventListeners', enabled: true }],
		}));
		poppers[popperId].update();
		const popperElement = document.getElementById(popperId);
		if (popperElement) {
			showPopper(popperElement);
		}
		return;
	}

	const popperInstance = node.popper({
		content: () => buildPopperDiv(node),
		popper: {
			placement: 'top',
			modifiers: [{ name: 'offset', options: { offset: [0, 8] } }],
		},
	});

	popperInstance.update();
	poppers[`${node.id()}_popper`] = popperInstance;

	const update = () => popperInstance.update();
	node.on('position', update);
	cy.on('pan zoom resize', update);
}

function hidePopper(popperElement) {
	popperElement.removeAttribute('data-show');
	popperElement.style.pointerEvents = 'none';
}

function showPopper(popperElement) {
	popperElement.setAttribute('data-show', 'true');
	popperElement.style.pointerEvents = 'auto';
}

function removePopper(node) {
	const popperId = `${node.id()}_popper`;
	if (poppers[popperId]) {
		poppers[popperId].setOptions((options) => ({
			...options,
			modifiers: [...options.modifiers, { name: 'eventListeners', enabled: false }],
		}));
	}
	const popperElement = document.getElementById(popperId);
	if (popperElement) {
		hidePopper(popperElement);
	}
}

function generateContextButtons(cy, full_context, parent_icons) {
	const contexts = full_context.split('/');
	const filteredContexts = contexts.filter((context) => context !== '');

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
		button.classList.add('context-button');
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
			const nodeName = event.target.getAttribute('nodeFullPath');
			updateGraph(cy, nodeName).then((nodeData) => {
				cy.elements().remove();
				deletePoppers();
				displayNodeContext(cy, nodeName, nodeData);
			});
		});

		container.appendChild(button);
	});

	const buttonContainer = document.getElementById('context-display');
	buttonContainer.appendChild(container);
}

function buildPopperDiv(node) {
	// Loader bar is located between geo1 and cook status.
	const nodeContext = node.data('path');
	const nodeCache = nodeGraphManager.getNodeStateCache(nodeContext);

	const nodeName = node.data('id');
	const nodeLastCooked = nodeCache?.lastCooked ?? node.data('cooktime');

	const nodeStartFrame = nodeCache?.startFrame ?? nodeGraphManager.getDefaultStart();
	const nodeEndFrame = nodeCache?.endFrame ?? nodeGraphManager.getDefaultEnd();
	const thumbnailSource = nodeCache?.thumbnail ?? '';
	const thumbnailDisplay = thumbnailSource ? 'display: block;' : 'display: none;';

	const html = `
        <div class="card">
            <div class="card-body">
                <div id="node-context-container">
                    <div id="node-context">
                        <p id="popper-node-name">${nodeName}</p>
                        <p id="popper-node-context">${nodeContext}</p>
                        <!-- Placeholder for the image -->
                        <div id="node-image-container">
                            <img id="node-thumbnail" src="${thumbnailSource}" alt="Node thumbnail" data-node-path="${nodeContext}" style="${thumbnailDisplay}">
                        </div>
                    </div>
                </div>
                <div id="node-cook-bar-container">
                    <div id="cooking-status" class="node-status-label">Progress:</div>
                    <div id="cooking-bar" data-node-path="${nodeContext}"></div>
                </div>
                <div id="node-status-container">
                    <div id="node-status">
                        <div class="node-status-label">
                            Last Cooked:
                        </div>
                        <div class="node-status-value" id="node-last-cooked" data-node-path="${nodeContext}">
                        </div>
                    </div>
                </div>
                <div id="frame-input-container">
                    <label for="start-frame">Start/End</label>
                    <input type="number" id="start-frame" name="startFrame" min="1" class="frame-input" value="${nodeStartFrame}">
                    <input type="number" id="end-frame" name="endFrame" min="2" class="frame-input" value="${nodeEndFrame}">
                </div>
                <div id="render-button-container">
                    <button id="submitRender" class="render-btn">Submit</button>
                </div>
            </div>
        </div>`;

	const truncated_html = `
        <div class="card">
            <div class="card-body">
                <div id="node-context-container">
                    <div id="node-context">
                        <p id="popper-node-name">${nodeName}</p>
                        <p id="popper-node-context">${nodeContext}</p>
                    </div>
                </div>
                <div id="node-status-container" class="invalid-node">
                    <div id="node-status">
                        <div class="node-status-label">
                            Invalid Status:
                        </div>
                        <div class="node-status-value">
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

	const div = document.createElement('div');
	div.id = `${node.id()}_popper`;
	document.body.appendChild(div);

	if (node.data('can_cook')[0]) {
		div.innerHTML = html;
	} else {
		const error_msg = node.data('can_cook')[1];
		div.innerHTML = truncated_html;

		const status_value = div.querySelector('.node-status-value');
		status_value.textContent = error_msg;
	}

	div.setAttribute('data-show', 'true');
	const nodeStatusValue = div.querySelector('#node-last-cooked');
	if (nodeStatusValue) {
		nodeStatusValue.textContent = nodeLastCooked || 'Uncooked';
	}

	// Allow for CSS to pickup on transition.
	setTimeout(() => {
		div.setAttribute('data-show', 'true');
	}, 20);

	const button = div.querySelector('#submitRender');
	if (button) {
		button.addEventListener('click', function () {
			handleSubmit(node);
		});
	}

	const frameInputs = document.querySelectorAll('.frame-input');
	frameInputs.forEach((input) => {
		input.addEventListener('input', function (e) {
			const value = e.target.value;
			const frameInputName = e.target.name;
			nodeGraphManager.updateNodeStateCache(nodeContext, frameInputName, value);
		});
	});

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
	let nodePath = data.nodePath;
	let progress = data.progress;
	let bar = document.querySelector(`#cooking-bar[data-node-path="${nodePath}"]`);
	if (bar) {
		bar.style.width = progress + '%';
	}
}

function handleThumbUpdate(data) {
	// Pass data to the rendered "page"
	// Just pass the data there.
	// Update underlying data structure?
	console.log(data);
}

function handleThumbFinish(data) {
	const thumbUrl = DEFAULT_THUMBNAIL_ROUTE + data.fileName;
	nodeGraphManager.updateNodeStateCache(data.nodePath, 'thumbnail', thumbUrl);

	const thumbnail = document.querySelector(`#node-thumbnail[data-node-path="${data.nodePath}"]`);
	if (thumbnail) {
		thumbnail.src = thumbUrl;
		thumbnail.style.display = 'block';
	}

	// Update the Stored Models Page
	updateStoredModelEntry(data);
}

function updateStoredModelEntry(data) {
	const fileContainer = document.querySelector(`.file-container[file-uuid="${data.hipFile}"]`);
	if (!fileContainer) {
		return;
	}

	const loadingAnimation = fileContainer.querySelector(
		`.animation-holder[data-node-path="${data.nodePath}"]`,
	);
	const thumbCard = fileContainer.querySelector(`.thumb-card[data-node-path="${data.nodePath}"]`);

	if (loadingAnimation && thumbCard) {
		const glb_path = loadingAnimation.getAttribute('glb-path');
		const img = createThumbnail(data.fileName, data.nodePath, data.hipFile, glb_path);
		loadingAnimation.parentNode.replaceChild(img, loadingAnimation);
	}
}

function handleRenderFinish(data) {
	nodeGraphManager.addRender(data.fileName, data.nodePath, data.frameRange);
	nodeGraphManager.updateNodeStateCache(data.nodePath, 'has_cooked', true);
	handlePostRender(data.nodePath);
}

function startRenderTask(node) {
	const startFrameInput = document.getElementById('start-frame');
	const endFrameInput = document.getElementById('end-frame');

	const start = parseInt(startFrameInput.value, 10);
	const end = parseInt(endFrameInput.value, 10);

	// Validate render settings here:
	if (!validateSubmission(start, end)) {
		return;
	}

	const nodePath = node.data('path');

	// Emit the render task event.
	submitRenderTask(start, end, nodePath);
}

function submitRenderTask(start, end, nodePath) {
	appState.socket.timeout(5000).emit(
		'submit_render_task',
		{
			start: start,
			end: end,
			step: 1,
			path: nodePath,
			file: nodeGraphManager.getLatestUUID(),
		},
		(err, response) => {
			if (err) {
				// Server doesn't acknowledge event within timeout.
				console.error("Server didn't acknowledge render event.");
			} else {
				const render_status = response.success;
				if (!render_status) {
					// TODO Display to user that submission failed.
					console.error(response.message);
					return;
				}

				// TODO Display successful submission
				console.log(response.message);

				// Hide the thumbnail (if it exists)
				const thumbnail = document.querySelector(
					`#node-thumbnail[data-node-path="${nodePath}"]`,
				);
				if (thumbnail) {
					thumbnail.style.display = 'none';
				}
			}
		},
	);
}

function validateSubmission(start, end) {
	if (start >= end) {
		console.error('Start frame must be less than end frame.');
		return false;
	}

	if (!appState.socket) {
		console.error('WebSocket has not been initialized!');
		return false;
	}

	return true;
}

function handleContextSubmission(currentContext) {
	initSocket();
	startContextRenderTask(currentContext);
}

function handleSubmit(node) {
	initSocket();
	startRenderTask(node);
}

function startContextRenderTask(currentContext) {
	const start = nodeGraphManager.getDefaultStart();
	const end = nodeGraphManager.getDefaultEnd();

	// Validate render settings here:
	if (!validateSubmission(start, end)) {
		return;
	}

	submitRenderTask(start, end, currentContext);
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
	const last_cooked = document.querySelector(`.node-status-value[data-node-path="${nodePath}"]`);
	if (last_cooked) {
		const cook_time = getCurrentFormattedTime();
		nodeGraphManager.updateNodeStateCache(nodePath, 'lastCooked', cook_time);
		last_cooked.textContent = cook_time;
	}
}

async function updateGraph(cy, nodeName, file_uuid = globalFileUuid, store_view_state = true) {
	if (!file_uuid) {
		throw new Error('Please pass a .hip UUID.');
	}
	if (!nodeName) {
		throw new Error('Node name is required.');
	}

	try {
		let initialize_hip = false;
		if (globalFileUuid == null) {
			initialize_hip = true;
		}
		globalFileUuid = file_uuid;
		const response = await fetch(`/node_data?uuid=${file_uuid}&name=${nodeName}`);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		if (store_view_state) {
			const oldContext = nodeGraphManager.getLatestContext();
			nodeGraphManager.updateViewStateCache(oldContext, cy.zoom(), cy.pan());
		}

		nodeGraphManager.updateContext(nodeName);
		return await response.json();
	} catch (error) {
		console.error('Error fetching node data: ', error);
	}
}
