import { onNodeGraphExit, hideRenderCanvas, handleDisplayModel } from './sidebar';
import { nodeGraphManager } from './node_graph';
import { DEFAULT_THUMBNAIL_ROUTE } from './constants';

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

export function handleStoredModelsToggle(storedModels, sidebar, toggled_button) {
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

export async function handleStoredModels() {
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

	const userUuid = localStorage.getItem('userUuid');
	if (userUuid !== null) {
		console.log('The user UUID is:', userUuid);

		try {
			const response = await fetch(
				`get_stored_models?userUuid=${encodeURIComponent(userUuid)}`,
			);

			if (!response.ok) {
				throw new Error(`Failed to load the node graph, status: ${response.status}`);
			}
			const data = await response.json();
			populateFiles(data.model_data);
		} catch (error) {
			console.error('Error fetching stored models:', error.message);
		}
	} else {
		console.log('No user UUID found in localStorage.');
	}
}

function populateFiles(files) {
	if (!Array.isArray(files)) {
		console.error('Invalid input: expected an array, got', typeof files);
		return;
	}

	const container = document.getElementById('models-container');
	container.innerHTML = '';

	files.forEach((file) => {
		if (!file.glb) {
			return;
		}

		const fileContainer = document.createElement('div');
		fileContainer.className = 'file-container';
		fileContainer.setAttribute('file-uuid', file.file_uuid);

		const nameContainer = document.createElement('div');
		nameContainer.className = 'name-container';

		const contentDiv = document.createElement('div');
		contentDiv.className = 'model-content';

		const fileNameLabel = document.createElement('div');
		fileNameLabel.className = 'file-name-label';

		const fileName = file.original_filename || 'Unnamed File';
		fileNameLabel.innerText = fileName;

		container.appendChild(fileContainer);
		fileContainer.appendChild(nameContainer);
		fileContainer.appendChild(contentDiv);
		nameContainer.appendChild(fileNameLabel);

		Object.entries(file.glb).forEach(([key, value]) => {
			const thumbCard = document.createElement('div');
			thumbCard.className = 'thumb-card';
			thumbCard.setAttribute('data-node-path', key);

			let thumbUrl = '';
			if (file.thumb && file.thumb[key]) {
				const img = createThumbnail(file.thumb[key], key, file.original_filename, value);
				thumbCard.appendChild(img);
			} else {
				const loadingHolder = document.createElement('div');
				loadingHolder.className = 'animation-holder';
				loadingHolder.setAttribute('data-node-path', key);
				loadingHolder.setAttribute('glb-path', value);

				const loadingIndicator = document.createElement('div');
				loadingIndicator.className = 'loader_animation';

				loadingHolder.appendChild(loadingIndicator);
				thumbCard.appendChild(loadingHolder);
			}

			const cardBody = document.createElement('div');
			cardBody.className = 'model-card-body';

			const cardTitle = document.createElement('h6');
			cardTitle.className = 'card-title';
			cardTitle.innerText = key;

			const cardText = document.createElement('p');
			if (file.render_time && file.render_time[key]) {
				const utcTimeString = file.render_time[key];
				// Python datetime doesn't support 'Z' suffix, add it here.
				const date = new Date(utcTimeString + (utcTimeString.endsWith('Z') ? '' : 'Z'));

				const readableDate = date.toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				});
				const readableTime = date.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});
				const formattedDateTime = `${readableDate} at ${readableTime}`;
				cardText.innerText = formattedDateTime;
			} else {
				cardText.innerText = '';
			}

			const frameRangeInfo = document.createElement('p');
			if (file.frame_range && file.frame_range[key]) {
				let frameRangeParts = file.frame_range[key].split('-');

				let frameRangeDisplay;
				if (frameRangeParts.length == 2) {
					frameRangeDisplay = `<b>Frame Range:</b> ${frameRangeParts[0]} to ${frameRangeParts[1]}`;
				} else if (frameRangeParts.length == 1) {
					frameRangeDisplay = `<b>Frame:</b> ${frameRangeParts[0]}`;
				} else {
					frameRangeDisplay = `<b>Unknown Frame Data:</b> ${frameRangeString}`;
				}
				frameRangeInfo.innerHTML = frameRangeDisplay;
			} else {
				frameRangeInfo.innerHTML = '';
			}

			cardBody.appendChild(cardTitle);
			cardBody.appendChild(cardText);
			cardBody.appendChild(frameRangeInfo);
			thumbCard.appendChild(cardBody);
			contentDiv.appendChild(thumbCard);

			window.requestAnimationFrame(() => {
				adjustCardTitleToContainer(cardTitle);
			});
		});

		const infoDiv = document.createElement('div');
		infoDiv.className = 'stored-model-info';
		contentDiv.appendChild(infoDiv);
	});
}

function adjustCardTitleToContainer(cardTitle) {
	var size = parseInt(getComputedStyle(cardTitle).getPropertyValue('font-size'));

	const parentStyle = getComputedStyle(cardTitle.parentElement);
	const paddingRight = parseInt(parentStyle.paddingRight);
	const parent_width = cardTitle.parentElement.clientWidth;

	while (cardTitle.scrollWidth > parent_width - paddingRight) {
		size -= 1;
		cardTitle.style.fontSize = size + 'px';
		cardTitle.offsetHeight;
	}
}

export function createThumbnail(thumb_name, nodePath, filePath, glbPath) {
	const thumbUrl = DEFAULT_THUMBNAIL_ROUTE + thumb_name;

	const img = document.createElement('img');
	img.src = thumbUrl;
	img.className = 'model-img';
	img.setAttribute('data-node-path', nodePath);
	img.setAttribute('data-file-path', filePath || 'Unnamed File');
	img.setAttribute('data-glb-path', glbPath);
	img.style.display = 'block';

	img.addEventListener('click', function () {
		const glbPath = this.dataset.glbPath;

		if (glbPath) {
			handleDisplayModel(glbPath);
			nodeGraphManager.updateLatestRender(glbPath);
		} else {
			const nodePath = this.dataset.nodePath;
			const filePath = this.dataset.filePath;
			console.error(`${filePath}-${nodePath}`);
			console.error('Unable to locate entry.');
		}
	});

	return img;
}
