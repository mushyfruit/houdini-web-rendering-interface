import * as modelDisplay from './model_display';
import { nodeGraphManager, initNodeGraph, deletePoppers } from './node_graph';
import { handleStoredModels, handleStoredModelsToggle } from './stored_models';

import Swal from 'sweetalert2';

document.addEventListener('DOMContentLoaded', (event) => {
	getUserID();
	connectFileInput();
	toggleSidebar();
	setupSidebar();
	connectHIP();
});

function getUserID() {
	let userUuid = localStorage.getItem('userUuid');
	if (!userUuid) {
		fetch('generate_user_uuid')
			.then((response) => {
				if (!response.ok) throw new Error('Failed to generate new UUID');
				return response.json();
			})
			.then((data) => {
				userUuid = data.user_uuid;
				localStorage.setItem('userUuid', userUuid);
				console.log('New user UUID generated and stored:', userUuid);
			})
			.catch((error) => console.error('Error generating UUID:', error));
	} else {
		console.log('Found existing UUID for the user:', userUuid);

		// Retrieve the csrfToken as we're making a state-changing request.
		const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

		fetch('set_existing_user_uuid', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-CSRFToken': csrfToken,
			},
			body: JSON.stringify({ userUuid: userUuid }),
		})
			.then((response) => {
				if (!response.ok) throw new Error('Failed to set existing UUID');
				return response.json();
			})
			.then((data) => console.log('Success:', data))
			.catch((error) => console.error('Error setting UUID on server:', error));
	}
}

async function connectHIP() {
	const uploadForm = document.querySelector('.uploadForm');
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
	});
}

export function hideRenderCanvas() {
	var canvas = document.getElementById('renderCanvas');
	if (canvas) {
		canvas.style.zIndex = -1;
		canvas.style.display = 'none';
	}
	modelDisplay.hideSettingsPanel();
	modelDisplay.stopRenderLoop();
}

function showRenderCanvas() {
	var canvas = document.getElementById('renderCanvas');
	if (canvas && canvas.style.display === 'none') {
		canvas.style.display = 'block';
		canvas.style.zIndex = 1;
		modelDisplay.prepareModelDisplay();
	}
}

async function fetch_node_graph(file_uuid, default_context = '/obj') {
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
	const fileInput = document.querySelector('.file-input');
	const fileNameDisplay = document.querySelector('.file-name-display');

	fileNameDisplay.addEventListener('click', function (e) {
		fileInput.click();
	});

	fileInput.addEventListener('change', function () {
		let fileName = this.files[0].name;
		fileNameDisplay.value = fileName;
	});
}

function toggleSidebar() {
	const menuBtn = document.querySelector('.menu-btn');
	const sidebar = document.querySelector('.sidebar');
	const uploadContainer = document.querySelector('.wrapped-container');

	menuBtn.addEventListener('click', () => {
		sidebar.classList.toggle('active');
		if (sidebar.classList.contains('file-upload')) {
			sidebar.classList.remove('file-upload');
			slideToggle(uploadContainer);
		}

		if (!sidebar.classList.contains('file-upload') && sidebar.classList.contains('active')) {
			sidebar.style.transitionDuration = '0.5s';
		}

		const storedModels = document.querySelector('.stored-models');
		if (storedModels) {
			handleStoredModelsToggle(storedModels, sidebar, false);
		}

		const transitionEnded = function () {
			sidebar.removeEventListener('transitionend', transitionEnded);
			sidebar.style.transitionDuration = '';
		};

		sidebar.addEventListener('transitionend', transitionEnded);
	});
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
			latest_context = '/obj';
		}
		await fetch_node_graph(latestResponse, latest_context);
	}
}

export function onNodeGraphExit() {
	let cy = document.getElementById('cy');
	if (cy) {
		const oldContext = nodeGraphManager.getLatestContext();
		nodeGraphManager.updateViewStateCache(oldContext, window.getCyZoom(), window.getCyPan());
	}
	deletePoppers();
}

export function handleDisplayModel(renderFilename = null) {
	// If the displayModel's active class hasn't been toggled, do it now.
	let displayModel = document.getElementById('display-model');
	if (displayModel && !displayModel.classList.contains('active')) {
		removeClassFromElements(getSiblings(displayModel), 'active');
		displayModel.classList.toggle('active');
	}

	onNodeGraphExit();
	showRenderCanvas();
	document.querySelector('.main-body').innerHTML = '';

	const fileToLoad = renderFilename || nodeGraphManager.getLatestRender() || 'placeholder.glb';
	const fileMetaData = nodeGraphManager.getRender(fileToLoad);
	const frameRange = fileMetaData ? fileMetaData['frameRange'] : [1, 240];
	modelDisplay.loadModel(fileToLoad, frameRange);
}

function setupSidebar() {
	const sidebar = document.querySelector('.sidebar');
	const menuItems = document.querySelectorAll('.menu > ul > li');
	menuItems.forEach((menuItem) => {
		// Avoid setting up event listener for download buttons.
		if (menuItem.classList.contains('no-active')) {
			return;
		}
		menuItem.addEventListener('click', function (e) {
			removeClassFromElements(getSiblings(this), 'active');
			toggleClass(this, 'active');

			getSiblings(this).forEach((sibling) => {
				let siblingUl = sibling.querySelector('ul');
				if (siblingUl) {
					removeClassFromElements(siblingUl.querySelectorAll('li'), 'active');
				}
			});

			let submenu = this.querySelector('ul.sub-menu');
			if (submenu) {
				slideToggle(submenu);
			}
		});
	});

	const displayModel = document.getElementById('display-model');
	displayModel.addEventListener('click', (e) => {
		handleDisplayModel();
	});

	const nodeGraph = document.getElementById('node-graph');
	nodeGraph.addEventListener('click', (e) => {
		handleNodeGraph().catch((error) => {
			console.error('Failed to handle the Node Graph:', error);
		});
	});

	const storedModels = document.getElementById('stored-models');
	storedModels.addEventListener('click', (e) => {
		handleStoredModels().catch((error) => {
			console.error('Failed to handle the Stored Model:', error);
		});
	});

	const hipUploader = document.querySelector('.hip-upload');
	hipUploader.addEventListener('click', function (e) {
		if (!sidebar.classList.contains('file-upload') && sidebar.classList.contains('active')) {
			sidebar.style.transitionDuration = '0.5s';
		}

		if (sidebar.classList.contains('active')) {
			sidebar.classList.toggle('active');
		}

		const storedModels = document.querySelector('.stored-models');
		if (storedModels) {
			handleStoredModelsToggle(storedModels, sidebar, true);
		}

		const transitionEnded = function () {
			sidebar.removeEventListener('transitionend', transitionEnded);
			sidebar.style.transitionDuration = '';
		};

		sidebar.addEventListener('transitionend', transitionEnded);
		let uploadContainer = document.querySelector('.wrapped-container');
		if (sidebar.classList.contains('file-upload')) {
			slideToggle(uploadContainer);
			setTimeout(function () {
				sidebar.classList.toggle('file-upload');
			}, 350);
		} else {
			sidebar.classList.toggle('file-upload');
			sidebar.addEventListener('transitionend', function onTransitionEnd(event) {
				// Make sure we're listening for the end of the correct transition, e.g., width
				if (event.propertyName === 'width') {
					slideToggle(uploadContainer);

					// Remove this event listener so it only runs once
					sidebar.removeEventListener('transitionend', onTransitionEnd);
				}
			});
		}
	});

	const modelDownloader = document.querySelector('.download-model');
	if (modelDownloader) {
		modelDownloader.addEventListener('click', async (e) => {
			await downloadActiveItem('glb');
		});
	}

	const hipDownloader = document.querySelector('.download-hip');
	if (hipDownloader) {
		hipDownloader.addEventListener('click', async (e) => {
			await downloadActiveItem('hip');
		});
	}

	const helpButton = document.querySelector('.help-btn');
	if (helpButton) {
		helpButton.addEventListener('click', (e) => {
			displayHelpInformation();
		});
	}
}

function slideToggle(element) {
	if (!element.classList.contains('toggled')) {
		element.classList.add('toggled');
		element.style.height = '';
		element.offsetHeight;

		let height = element.clientHeight + 'px';
		element.style.height = '0px';
		setTimeout(() => {
			element.style.height = height;
		}, 0);
	} else {
		element.style.height = '0px';
		element.addEventListener(
			'transitionend',
			() => {
				element.classList.remove('toggled');
			},
			{ once: true },
		);
	}
}

async function downloadActiveItem(ext) {
	let requestItem;
	if (ext === 'hip') requestItem = nodeGraphManager.getLatestUUID();
	else if (ext === 'glb') {
		requestItem = nodeGraphManager.getLatestRender();
	} else {
		console.error('Invalid download extension type!');
		return;
	}

	if (requestItem)
		try {
			const response = await fetch(
				`/generate_download?filename=${encodeURIComponent(requestItem)}&ext=${encodeURIComponent(ext)}`,
			);
			if (!response.ok) {
				throw new Error(response.message);
			}

			const jsonData = await response.json();
			if (jsonData.download_link) {
				await fetchModel(jsonData.download_link);
			}
		} catch (error) {
			console.error('Unable to download the active model:', error);
		}
}

async function fetchModel(downloadLink) {
	try {
		const response = await fetch(downloadLink);
		if (!response.ok) {
			throw new Error(response.message);
		}

		const blob = await response.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.style.display = 'none';
		a.href = url;

		// Use the filename from the response headers if available, otherwise set a default
		const contentDisposition = response.headers.get('Content-Disposition');
		let filename = 'download.glb';
		if (contentDisposition) {
			const match = contentDisposition.match(/filename="?([^"]+)"?/);
			if (match.length > 1) {
				filename = match[1];
			}
		}

		a.download = filename;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	} catch (error) {
		console.error('Unable to download the active model:', error);
	}
}

function displayHelpInformation() {
	Swal.fire({
		title: 'Using the Houdini Web Previewer',
		html: `
			<div class="help-align-left">
				<div class="help-align-center-small">
					<p>Preview, render, and share the contents of a Houdini workfile without leaving your browser!</p>
				</div>
				<br>
				<ol>
					<li><strong>Upload a HIP File:</strong> Click on 'Upload HIP' <i class="icon ph-bold ph-upload-simple larger-help-icon"></i> and select your HIP file from your computer.</li>
					<li><strong>Node Graph Preview</strong> Click on 'Node Graph' <i class="icon ph-bold ph-graph larger-help-icon"></i> to preview the uploaded HIP's node graph in the browser.</li>
						<ul class="help-list">
							<li>Render Context: Click 'Render Context' to export a glTF file in the current node graph's context.</li>
							<li>Navigation: Double-click a node to enter it. Jump to a specific context via the uppermost context bar.</li>
							<li>Render Node: Left-click a node to open the per-node render pane.</li>
							<li>Settings: Specify custom start and end values to determine length of glTF's animation.</li>
						</ul>
					<li><strong>View the Export:</strong> Once uploaded, the 3D model will be available by clicking "Display Model" <i class="icon ph-bold ph-monitor larger-help-icon"></i> in the sidebar.</li>
					<li><strong>View Previous Exports:</strong> Previously output glTF files will be available for preview on the "Stored Models" <i class="icon ph-bold ph-archive larger-help-icon"></i> page.</li>
				</ol>
				<br>
				<div class="help-align-center-small">
					<p>Visit the <a href="https://github.com/mushyfruit/houdini-web-rendering-interface" target="_blank">GitHub repo</a> for more help or to provide feedback.</p>
				</div>
            </div>
        `,
		icon: 'question',
		animation: false,
		width: '70%',
	});
}

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
		element.classList.remove(className);
	});
}

function toggleClass(element, className) {
	element.classList.toggle(className);
}
