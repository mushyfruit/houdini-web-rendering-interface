import * as BABYLON from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import { Pane } from 'tweakpane';
import { createPopper } from '@popperjs/core';
import { DISPLAY_UI_PARAMS, DEFAULT_SKYBOXES, DEFAULT_CAMERA_OPTION } from './constants';

// Must specify the loader as suffix here.
import '@babylonjs/loaders/glTF';

let sceneManager, globalSettings;

class SceneManager {
	constructor() {
		this.canvas = document.getElementById('renderCanvas');
		this.engine = null;

		this.scene = null;
		this.frozen = false;
		this.frozen_lock = false;
		this.skyboxes = [];
		this.skyboxMeshes = {};
		this.skyboxValues = [];
		this.preRenderRegistered = false;

		this.lightingBlade = null;
		this.shareBlade = null;
		this.currentSceneLights = null;
		this.defaultLights = [];
		this.isDefaultSkyboxLoaded = false;

		this.pane = null;
		this.cameraFolder = null;
		this.cameraBlade = null;

		this.animationFolder = null;

		this.debugGrid = null;
		this.axes = null;
	}

	async _createEngine() {
		const webGPUSupported = await BABYLON.WebGPUEngine.IsSupportedAsync;
		if (webGPUSupported) {
			const engine = new BABYLON.WebGPUEngine(this.canvas);
			await engine.initAsync();
			return engine;
		}
		// WebGL2 by default.
		return new BABYLON.Engine(this.canvas, true);
	}

	async _initialize() {
		this.engine = await this._createEngine();
		this._createScene();
		this._createSettingsPane();
		this._createDefaultCamera();
		this._createSkyboxTextures();

		if (globalSettings.guiParams.displayBindings.grid) {
			const size = globalSettings.guiParams.displayBindings.grid_size;
			this.createDebugGrid(size, true);
		}
	}

	_createScene() {
		this.scene = new BABYLON.Scene(this.engine);

		if (this.canvas) {
			this.canvas.width = window.innerWidth;
			this.canvas.height = window.innerHeight;
		}
		window.addEventListener('resize', () => {
			this.engine.resize();
		});
	}

	_createSettingsPane() {
		this.pane = new Pane({
			container: document.getElementById('tp-container'),
			title: 'Houdini Web Viewer',
			expanded: globalSettings.guiParams.ui.pane.expanded,
		});
	}

	_createDefaultCamera() {
		this.camera = new BABYLON.ArcRotateCamera(
			'defaultCamera',
			Math.PI / 2,
			Math.PI / 2.5,
			15,
			new BABYLON.Vector3(0, 0, 0),
		);
		this.camera.attachControl(this.canvas, true);

		// Adjust the scrolling zoom speed.
		this.camera.wheelPrecision = 50;
		this.camera.maxZ = 150000;
		this.camera.minZ = 0;
	}

	_createSkyboxTextures() {
		// Generate .env from .hdr file: https://www.babylonjs.com/tools/ibl/
		// Custom packing IBL environment into single, optimized file.
		this.skyboxValues = Object.values(DEFAULT_SKYBOXES);
		this.skyboxes = this.skyboxValues.map((url, index, arr) => {
			const texture = new BABYLON.CubeTexture(`/static/skybox/${url}`, this.scene);
			texture.level = 0.65;
			return texture;
		});
	}

	handleFreeze(clear = false) {
		if (clear) {
			this.frozen_lock = false;
		}
		if (this.frozen || this.frozen_lock) {
			return;
		}

		this.scene.freezeActiveMeshes();
		this.frozen = true;
	}

	handleUnfreeze(keep_frozen = false) {
		this.frozen_lock = keep_frozen;
		if (!this.frozen) {
			return;
		}

		this.scene.unfreezeActiveMeshes();
		this.scene.freeActiveMeshes();
		this.frozen = false;
	}

	clearSceneLights() {
		this.currentSceneLights = [];
	}

	createDebugGrid(grid_size, enabled = false) {
		sceneManager.handleUnfreeze();
		const grid = BABYLON.MeshBuilder.CreateGround(
			'ground',
			{ width: grid_size, height: grid_size, updatable: true },
			this.scene,
		);

		const gridTexture = new GridMaterial('grid', this.scene);

		gridTexture.backFaceCulling = false;
		gridTexture.mainColor = BABYLON.Color3.Black();
		gridTexture.lineColor = BABYLON.Color3.Black();
		gridTexture.opacity = 0.5;

		grid.material = gridTexture;
		grid.alwaysSelectAsActiveMesh = true;
		grid.isPickable = false;
		grid.setEnabled(false);

		this.debugGrid = grid;

		// Default to locking axes at 8 for now.
		this.axes = this.createAxes(8);

		if (enabled) {
			this.debugGrid.setEnabled(true);
			this.axes.forEach((axis) => {
				axis.setEnabled(true);
			});
		}

		this.debugGrid.alwaysSelectAsActiveMesh = true;
		sceneManager.handleFreeze();
	}

	createAxes(grid_size) {
		const axes = {
			x: { direction: BABYLON.Vector3.Right(), color: BABYLON.Color3.Red() },
			y: { direction: BABYLON.Vector3.Up(), color: BABYLON.Color3.Green() },
			z: { direction: BABYLON.Vector3.Backward(), color: BABYLON.Color3.Blue() },
		};

		const lines = [];
		const unitLength = grid_size / 2;

		for (const axis in axes) {
			const { direction, color: axis_color } = axes[axis];
			const p1 = new BABYLON.Vector3(unitLength, unitLength, unitLength).multiplyInPlace(
				direction,
			);
			const p2 = p1.scale(-1);

			const line = BABYLON.MeshBuilder.CreateLines(
				`${axis}`,
				{
					points: [p1, p2],
					colors: [axis_color, axis_color],
					useVertexAlpha: false,
					updatable: false,
				},
				this.scene,
			);
			line.isPickable = false;
			line.setEnabled(false);
			line.alwaysSelectAsActiveMesh = true;
			lines.push(line);
		}

		return lines;
	}

	toggleLightBlade(value) {
		if (this.lightingBlade) {
			this.lightingBlade.hidden = !value;
		}
	}

	toggleAnimationFolder(value) {
		if (this.animationFolder) {
			this.animationFolder.hidden = !value;
		}
	}

	toggleCameraFolder(value) {
		if (this.cameraFolder) {
			this.cameraFolder.hidden = !value;
		}
	}

	updateCameraOptions() {
		if (!this.cameraBlade) {
			return;
		}

		let newOptions = [DEFAULT_CAMERA_OPTION];
		for (let i = 1; i < this.scene.cameras.length; i++) {
			const houdiniCamera = this.scene.cameras[i].name;
			newOptions.push({ text: houdiniCamera, value: houdiniCamera });
		}
		this.cameraBlade.options = newOptions;
		this.cameraBlade.value = DEFAULT_CAMERA_OPTION.value;
		this.pane.refresh();
	}
}

class DisplaySettings {
	constructor() {
		this.guiParams = { ...DISPLAY_UI_PARAMS };
		this.lastTexture = undefined;
		this.loadParams();
	}

	saveParams() {
		localStorage.setItem('displaySettings', JSON.stringify(this.guiParams));
	}

	loadParams() {
		const savedSettings = JSON.parse(localStorage.getItem('displaySettings'));
		if (savedSettings) {
			this.guiParams = savedSettings;
		}
	}
}

function create_scene() {
	const scene = sceneManager.scene;

	const hemisphericLight = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(1, 1, 0));
	hemisphericLight.intensity = 0.6;

	// Tone it down a bit from the start.
	scene.environmentIntensity = 0.4;

	// const highPassKernel = [0, -1 / 8, 0, -1 / 8, 1.25, -1 / 8, 0, -1 / 8, 0];
	// const highPass = new BABYLON.ConvolutionPostProcess(
	// 	'highPass',
	// 	highPassKernel,
	// 	1.0,
	// 	sceneManager.camera,
	// );
	//
	// // Set up Ambient Occlusion
	// let ssaoRatio = {
	// 	ssaoRatio: 0.5,
	// 	blurRatio: 0.5,
	// };
	//
	// let ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene, ssaoRatio, null, false);
	// ssao.radius = 0.5;
	// ssao.totalStrength = 1.0;
	// ssao.expensiveBlur = false;
	// ssao.samples = 16;
	// ssao.maxZ = 250;

	// Need to attach relevant cameras or else it'll freeze the render.
	//scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', sceneManager.camera);

	// Store all default lights for toggling later.
	sceneManager.defaultLights.push(hemisphericLight);
	sceneManager.defaultLights.forEach((light) => {
		light.setEnabled(!globalSettings.guiParams.lightingBindings.disable_default_lighting);
	});

	return scene;
}

function setCurrentSkybox(index, setEnvironment = false) {
	if (
		globalSettings.guiParams.displayBindings.background ||
		globalSettings.guiParams.displayBindings.environment
	) {
		sceneManager.handleUnfreeze();
		if (sceneManager.skyboxMeshes[index] === undefined) {
			sceneManager.skyboxMeshes[index] = sceneManager.scene.createDefaultSkybox(
				sceneManager.skyboxes[index],
				true,
				1000,
				globalSettings.guiParams.lightingBindings.environment_blur,
			);
			sceneManager.skyboxMeshes[index].alwaysSelectAsActiveMesh = true;
			sceneManager.skyboxMeshes[index].setEnabled(
				globalSettings.guiParams.displayBindings.background,
			);

			if (setEnvironment) {
				sceneManager.scene.environmentTexture = sceneManager.skyboxes[index];
			}
		} else {
			if (setEnvironment) {
				sceneManager.scene.environmentTexture = sceneManager.skyboxes[index];
			}
		}

		// Disable all other skyboxes.
		if (globalSettings.guiParams.displayBindings.background) {
			Object.keys(sceneManager.skyboxMeshes).forEach((meshIndex) => {
				sceneManager.skyboxMeshes[meshIndex].setEnabled(parseInt(meshIndex) === index);
			});
		}

		sceneManager.handleFreeze();
	} else {
		globalSettings.lastTexture = index;
	}
}

function onInit() {
	prepareModelDisplay();
	applyPreLoadSettings();

	// Determine if we should load from a provided shareable link.
	const loadedFromLink = loadShareableLink();

	// If there's no specific file to load, then just load the placeholder.
	if (!loadedFromLink) {
		loadModel('placeholder.glb', [1, 240]);
	}
}

function loadShareableLink() {
	const currentPath = window.location.pathname;
	if (currentPath === '/view') {
		const params = new URLSearchParams(window.location.search);
		const nanoid = params.get('fileid');
		if (!nanoid) {
			return false;
		}

		loadModel(nanoid + '.glb', [1, 240], '/get_glb_from_nano/');
		return true;
	} else {
		return false;
	}
}

function applyPreLoadSettings() {
	if (globalSettings.guiParams.displayBindings.autorotate) {
		toggleAutoRotate();
	}
}

function applyPostLoadSkyboxSettings() {
	if (globalSettings.guiParams.lightingBindings.rotate_environment) {
		toggleEnvironmentRotation(true);
	}

	if (globalSettings.guiParams.displayBindings.environment) {
		toggleEnvironment(true);
	}
}

export function prepareModelDisplay() {
	// Restart the engine if necessary.
	if (sceneManager.engine.activeRenderLoops.length === 0) {
		startRenderLoop();
	}

	// Check if we've initialized the display settings panel.
	// If so, just ensure that the panel is unhidden.
	const panel = document.getElementById('tp-container');
	if (sceneManager.pane.children.length > 0) {
		panel.style.display = 'block';
	} else {
		generateSettingsPanel();
	}
}

function generateSettingsPanel() {
	globalSettings.loadParams();

	// Add the parent pane and handle storing settings on fold.
	sceneManager.pane.on('fold', (ev) => {
		globalSettings.guiParams.ui.pane.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Add the display folder and handle fold callback events.
	const displayFolder = sceneManager.pane.addFolder({
		title: 'Display',
		expanded: globalSettings.guiParams.ui.display.expanded,
	});
	displayFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.display.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	const display_bindings = [
		{ key: 'background', callbackFunc: toggleBackground, pass_value: true },
		{ key: 'environment', callbackFunc: toggleEnvironment, pass_value: true },
		{ key: 'wireframe', callbackFunc: toggleWireframe, pass_value: true },
		{ key: 'grid', callbackFunc: toggleGrid, pass_value: true },
		{
			key: 'grid_size',
			callbackFunc: updateGridSize,
			options: { min: 0, max: 1000, step: 10 },
			pass_value: true,
		},
		{ key: 'autorotate', callbackFunc: toggleAutoRotate, pass_value: false },
		{
			key: 'autorotate_speed',
			callbackFunc: adjustAutoRotateSpeed,
			options: { min: 0, max: 3, step: 0.05 },
			pass_value: true,
		},
		{ key: 'background_color', callbackFunc: updateBackgroundColor, pass_value: true },
	];

	display_bindings.forEach((binding) => {
		setupDefaultBinding(
			globalSettings.guiParams.displayBindings,
			displayFolder,
			binding.key,
			binding.callbackFunc,
			binding.options || {},
			binding.pass_value,
		);
	});

	const lighting_bindings = [
		{
			key: 'environment_exposure',
			callbackFunc: adjustExposure,
			options: { min: 0, max: 5, step: 0.05 },
			pass_value: true,
		},
		{
			key: 'environment_blur',
			callbackFunc: adjustEnvironmentBlur,
			options: { min: 0, max: 1, step: 0.01 },
			pass_value: true,
		},
		{
			key: 'environment_rotation',
			callbackFunc: adjustEnvironmentRotation,
			options: { min: 0, max: 360, step: 1 },
			pass_value: true,
		},
		{ key: 'rotate_environment', callbackFunc: toggleEnvironmentRotation, pass_value: true },
		{
			key: 'rotate_speed',
			callbackFunc: () => {},
			options: { min: 0, max: 100, step: 1 },
			pass_value: true,
		},
		{ key: 'disable_houdini_lighting', callbackFunc: toggleHoudiniLights, pass_value: true },
		{ key: 'disable_default_lighting', callbackFunc: toggleDefaultLights, pass_value: true },
	];

	const lightingFolder = sceneManager.pane.addFolder({
		title: 'Lighting',
		expanded: globalSettings.guiParams.ui.lighting.expanded,
	});
	lightingFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.lighting.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	const skyboxOptions = Object.keys(DEFAULT_SKYBOXES).map((key) => ({
		text: key,
		value: DEFAULT_SKYBOXES[key],
	}));

	lightingFolder
		.addBlade({
			view: 'list',
			label: 'environment',
			options: skyboxOptions,
			value: globalSettings.guiParams.lightingBindings.environment,
		})
		.on('change', (ev) => {
			if (!ev.last) return;
			setBackgroundTexture(ev.value);
			globalSettings.guiParams.lightingBindings.environment = ev.value;
			globalSettings.saveParams();
		});

	lighting_bindings.forEach((binding) => {
		setupDefaultBinding(
			globalSettings.guiParams.lightingBindings,
			lightingFolder,
			binding.key,
			binding.callbackFunc,
			binding.options || {},
			binding.pass_value,
		);
	});

	lightingFolder.children.forEach((child) => {
		if (child.key === 'disable_houdini_lighting') {
			sceneManager.lightingBlade = child;
		}
	});

	const cameraFolder = sceneManager.pane.addFolder({
		title: 'Camera',
		expanded: globalSettings.guiParams.ui.camera.expanded,
	});
	cameraFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.camera.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Hide this by default, if .glb with camera is found, unhide.
	cameraFolder.hidden = true;
	sceneManager.cameraFolder = cameraFolder;
	sceneManager.cameraBlade = cameraFolder
		.addBlade({
			view: 'list',
			label: 'camera',
			options: [DEFAULT_CAMERA_OPTION],
			value: globalSettings.guiParams.cameraBindings.camera,
		})
		.on('change', (ev) => {
			if (!ev.last) return;
			setSceneCamera(ev.value);
			globalSettings.guiParams.lightingBindings.environment = ev.value;
			globalSettings.saveParams();
		});

	const animationFolder = sceneManager.pane.addFolder({
		title: 'Animation',
		expanded: globalSettings.guiParams.ui.animation.expanded,
	});
	animationFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.animation.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Hide by default, dynamically populating if animations are found.
	animationFolder.hidden = true;
	sceneManager.animationFolder = animationFolder;

	const share_binding = {
		key: 'share',
		callbackFunc: copyLinkToClipboard,
		options: { readonly: true },
		pass_value: true,
		label_value: 'shareable link',
	};

	const shareFolder = sceneManager.pane.addFolder({
		title: 'Share Model',
		expanded: globalSettings.guiParams.ui.share.expanded,
	});
	shareFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.share.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	sceneManager.shareBlade = setupDefaultBinding(
		globalSettings.guiParams.shareBindings,
		shareFolder,
		share_binding.key,
		() => {},
		share_binding.options || {},
		share_binding.pass_value,
	);

	if (share_binding.label_value) {
		sceneManager.shareBlade.label = share_binding.label_value;
	}
	const blade_element = sceneManager.shareBlade.element;
	if (blade_element) {
		blade_element.addEventListener('click', function (e) {
			const bladeState = sceneManager.shareBlade.exportState();
			share_binding.callbackFunc(bladeState.binding.value);
		});
	}
}

function copyLinkToClipboard(link_value) {
	navigator.clipboard.writeText(link_value).then(
		function () {
			console.log('Copied to the clipboard.');
			showCopiedPopper();
		},
		function (err) {
			console.error('Could not copy text: ', err);
		},
	);
}

function showCopiedPopper() {
	const blade_element = sceneManager.shareBlade.element;
	const blade_sub_element = blade_element.querySelector('.tp-lblv_v');

	const tooltip = document.createElement('div');
	tooltip.className = 'copy-tooltip';
	tooltip.textContent = 'Copied to Clipboard!';

	const arrow = document.createElement('div');
	arrow.id = 'arrow';
	arrow.setAttribute('data-popper-arrow', '');
	tooltip.appendChild(arrow);

	document.body.appendChild(tooltip);
	const popperInstance = createPopper(blade_sub_element, tooltip, {
		placement: 'top',
		modifiers: [
			{
				name: 'offset',
				options: {
					offset: [0, 8],
				},
			},
			{
				name: 'arrow',
				options: {
					element: arrow,
					padding: ({ popper }) => popper.width / 2 - arrow.offsetWidth / 2,
				},
			},
		],
	});

	tooltip.classList.add('show');

	setTimeout(() => {
		tooltip.classList.remove('show');
		popperInstance.destroy();
		document.body.removeChild(tooltip);
	}, 1000);
}

function populateAnimationFolder(animations) {
	if (!sceneManager.animationFolder) {
		return;
	}

	// Clear the previously saved blades.
	sceneManager.animationFolder.children.forEach((child) => {
		child.dispose();
	});

	animations.forEach((animation, index) => {
		const animationName = `${index + 1}. ${animation.name}`;
		const defaultEnabled = index === 0;
		const param = { animationName: defaultEnabled };

		const binding = sceneManager.animationFolder
			.addBinding(param, 'animationName')
			.on('change', (ev) => {
				if (!ev.last) return;
				displayAnimation(ev.target, ev.value);
			});
		binding.label = animationName;
		binding.originalAnimation = animation;
	});
}

function displayAnimation(target, value) {
	if (target.originalAnimation) {
		if (value) {
			target.originalAnimation.start(true);
		} else {
			// Reset the animation to beginning and stop it.
			target.originalAnimation.goToFrame(1);
			target.originalAnimation.stop();
		}
	}
}

function toggleHoudiniLights(value) {
	if (sceneManager.currentSceneLights) {
		sceneManager.handleUnfreeze();
		sceneManager.currentSceneLights.forEach((light) => {
			light.setEnabled(!value);
		});
		sceneManager.handleFreeze();
	}
}

function toggleDefaultLights(value) {
	if (sceneManager.defaultLights) {
		sceneManager.handleUnfreeze();
		sceneManager.defaultLights.forEach((light) => {
			light.setEnabled(!value);
		});
		sceneManager.handleFreeze();
	}
}

function setBackgroundTexture(value) {
	const skyboxValues = Object.values(DEFAULT_SKYBOXES);
	const selectedIndex = skyboxValues.indexOf(value);

	if (selectedIndex === -1) {
		// Something went wrong, just fallback.
		setCurrentSkybox(0, true);
		globalSettings.lastTexture = 0;
		console.error(`Unable to find environment: ${value}`);
	} else {
		globalSettings.lastTexture = selectedIndex;
		setCurrentSkybox(selectedIndex, true);
		adjustEnvironmentBlur(globalSettings.guiParams.lightingBindings.environment_blur);
	}
	globalSettings.saveParams();
}

function setSceneCamera(value) {
	const newCamera = sceneManager.scene.getCameraByName(value);
	if (newCamera) {
		sceneManager.scene.activeCamera.detachControl();
		sceneManager.scene.activeCamera = newCamera;
		sceneManager.scene.activeCamera.attachControl(sceneManager.canvas, true);
	}
}

function setupDefaultBinding(settings, folder, key, callbackFunc, options, pass_value = false) {
	const blade = folder.addBinding(settings, key, options).on('change', (ev) => {
		if (!ev.last) return;
		if (pass_value) {
			callbackFunc(ev.value);
		} else {
			callbackFunc();
		}
		settings[key] = ev.value;
		globalSettings.saveParams();
	});

	// Remove any underscores to make the labels a bit nicer.
	if (key.includes('_')) {
		blade.label = key.replace(/_/g, ' ');
	}

	return blade;
}

function rgbStringToColor3(rgbString) {
	// Extract the RGB values from the string using a regular expression
	const result = rgbString.match(/\d+/g).map(Number);
	const [r, g, b] = result;
	return new BABYLON.Color3(r / 255, g / 255, b / 255);
}

function updateBackgroundColor(value) {
	sceneManager.scene.clearColor = rgbStringToColor3(value);
}

function adjustExposure(value) {
	sceneManager.scene.environmentIntensity = value;
}

function adjustEnvironmentBlur(value) {
	const currentMesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
	if (currentMesh) {
		currentMesh.material.microSurface = 1 - value;
	}
}

function adjustEnvironmentRotation(value) {
	const currentMesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
	if (!currentMesh && !sceneManager.scene.environmentTexture) {
		return;
	}
	const rotMatrix = BABYLON.Matrix.RotationY(BABYLON.Tools.ToRadians(value));

	if (currentMesh) {
		currentMesh.material.reflectionTexture.setReflectionTextureMatrix(rotMatrix);
	}

	if (sceneManager.scene.environmentTexture) {
		sceneManager.scene.environmentTexture.setReflectionTextureMatrix(rotMatrix);
	}
}

function toggleEnvironmentRotation(value) {
	if (value) {
		if (!sceneManager.preRenderRegistered) {
			sceneManager.scene.registerBeforeRender(rotateTexture);
			sceneManager.preRenderRegistered = true;
		}
	} else {
		if (sceneManager.preRenderRegistered) {
			sceneManager.scene.unregisterBeforeRender(rotateTexture);
			sceneManager.preRenderRegistered = false;
		}
	}
}

function mapRange(value, inMin, inMax, outMin, outMax) {
	return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

function rotateTexture() {
	if (
		!globalSettings.guiParams.displayBindings.background &&
		!globalSettings.guiParams.displayBindings.environment
	) {
		return;
	}

	if (globalSettings.guiParams.lightingBindings.rotate_speed === 0) {
		return;
	}

	const currentMesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];

	let matrix;
	if (currentMesh) {
		matrix = currentMesh.material.reflectionTexture.getReflectionTextureMatrix();
	} else {
		matrix = sceneManager.scene.environmentTexture.getReflectionTextureMatrix();
	}
	const theta = Math.atan2(matrix.m[8], matrix.m[10]);
	const angle = BABYLON.Tools.ToDegrees(theta);

	const perFrame = mapRange(globalSettings.guiParams.lightingBindings.rotate_speed, 0, 100, 0, 2);
	const rotMatrix = BABYLON.Matrix.RotationY(BABYLON.Tools.ToRadians(angle + perFrame));

	if (currentMesh) {
		currentMesh.material.reflectionTexture.setReflectionTextureMatrix(rotMatrix);
	}

	if (sceneManager.scene.environmentTexture) {
		sceneManager.scene.environmentTexture.setReflectionTextureMatrix(rotMatrix);
	}
}

function toggleGrid(value) {
	sceneManager.handleUnfreeze();

	if (!sceneManager.debugGrid) {
		sceneManager.createDebugGrid(globalSettings.guiParams.displayBindings.grid_size);
	}

	const gridEnabled = sceneManager.debugGrid.isEnabled();
	if (!gridEnabled) {
		updateGridSize(globalSettings.guiParams.displayBindings.grid_size);
	}
	sceneManager.axes.forEach((axis) => {
		axis.setEnabled(value);
	});
	sceneManager.debugGrid.setEnabled(value);

	sceneManager.handleFreeze();
}

function updateGridSize(value) {
	if (sceneManager.debugGrid && sceneManager.debugGrid.isEnabled()) {
		// Get the vertex positions
		let positions = sceneManager.debugGrid.getVerticesData(BABYLON.VertexBuffer.PositionKind);
		positions[0] = -value / 2;
		positions[1] = 0;
		positions[2] = value / 2;

		positions[3] = value / 2;
		positions[4] = 0;
		positions[5] = value / 2;

		positions[6] = -value / 2;
		positions[7] = 0;
		positions[8] = -value / 2;

		positions[9] = value / 2;
		positions[10] = 0;
		positions[11] = -value / 2;

		sceneManager.debugGrid.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
		sceneManager.debugGrid.refreshBoundingInfo();
	}
	globalSettings.guiParams.displayBindings.grid_size = value;
	globalSettings.saveParams();
}

function toggleAutoRotate() {
	const camera = sceneManager.scene.activeCamera;
	camera.useAutoRotationBehavior = !camera.useAutoRotationBehavior;
	if (camera.useAutoRotationBehavior) {
		camera.autoRotationBehavior.idleRotationSpeed =
			globalSettings.guiParams.displayBindings.autorotate_speed;
	}
}

function adjustAutoRotateSpeed(value) {
	const camera = sceneManager.scene.activeCamera;
	if (camera.autoRotationBehavior) {
		camera.autoRotationBehavior.idleRotationSpeed = value;
	}
}

function toggleBackground(value) {
	if (!value) {
		sceneManager.handleUnfreeze();
		const mesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
		mesh.setEnabled(false);
		sceneManager.handleFreeze();
	} else {
		setCurrentSkybox(globalSettings.lastTexture, false);
		adjustEnvironmentBlur(globalSettings.guiParams.lightingBindings.environment_blur);

		// Ensure we set the reflection texture's rotation to the correct rotation value.
		if (
			!globalSettings.guiParams.displayBindings.environment &&
			!globalSettings.guiParams.lightingBindings.rotate_environment
		) {
			adjustEnvironmentRotation(
				globalSettings.guiParams.lightingBindings.environment_rotation,
			);
		}

		toggleEnvironmentRotation(globalSettings.guiParams.lightingBindings.rotate_environment);
	}
}

function toggleEnvironment(value) {
	sceneManager.handleUnfreeze();
	if (!value) {
		sceneManager.scene.environmentTexture = undefined;
	} else {
		sceneManager.scene.environmentTexture = sceneManager.skyboxes[globalSettings.lastTexture];
		if (
			!globalSettings.guiParams.displayBindings.background &&
			!globalSettings.guiParams.lightingBindings.rotate_environment
		) {
			adjustEnvironmentRotation(
				globalSettings.guiParams.lightingBindings.environment_rotation,
			);
		}
		toggleEnvironmentRotation(globalSettings.guiParams.lightingBindings.rotate_environment);
	}
	sceneManager.handleFreeze();
}

function toggleWireframe(value) {
	sceneManager.scene.meshes.forEach((mesh) => {
		if (mesh.metadata && mesh.metadata.imported) {
			if (mesh.material) {
				if (!value) {
					if (mesh.material.originalEmissiveColor) {
						mesh.material.emissiveColor = mesh.material.originalEmissiveColor;
						mesh.material.originalEmissiveColor = null;
					}
				} else {
					if (mesh.material.emissiveColor) {
						if (!mesh.material.originalEmissiveColor) {
							mesh.material.originalEmissiveColor =
								mesh.material.emissiveColor.clone();
						}
					} else {
						mesh.material.originalEmissiveColor = BABYLON.Color3.Black();
					}
					mesh.material.emissiveColor = BABYLON.Color3.White();
				}
				mesh.material.wireframe = value;
			}
		}
	});
}

export function hideSettingsPanel() {
	const panel = document.getElementById('tp-container');
	if (panel) {
		panel.style.display = 'none';
	}
}

// Start and stop the render loop for performance.
export function stopRenderLoop() {
	sceneManager.engine.stopRenderLoop();
}

export function startRenderLoop() {
	sceneManager.engine.runRenderLoop(function () {
		sceneManager.scene.render();
	});
}

function generateShareableLink(fileName) {
	let nanoIdPromise;
	nanoIdPromise = fetch(`get_nano_id?filename=${encodeURIComponent(fileName)}`)
		.then((response) => {
			if (!response.ok) {
				throw new Error('Network response was not ok ' + response.statusText);
			}
			return response.json(); // Assuming the response is in JSON format
		})
		.then((data) => {
			const nanoId = data.nano_id;
			const currentUrl = window.location.origin; // Get the current URL's origin
			const shareableLink = `${currentUrl}/view?fileid=${nanoId}`;
			globalSettings.guiParams.shareBindings.share = shareableLink;
		})
		.catch((error) => {
			console.error('Nano ID generation failed:', error);
		});
}

// Handle loading and clearing models.
export function loadModel(fileName, frameRange, root_url = '/get_glb/') {
	sceneManager.handleUnfreeze(true);

	clearModels();
	BABYLON.SceneLoader.ImportMeshAsync(null, root_url, fileName, sceneManager.scene)
		.then((result) => {
			console.log('GLB Loaded Successfully!');

			// Retrieve the nano id shareable string.
			generateShareableLink(fileName);

			// Scene always contains default camera named "defaultCamera".
			const hasCameras = sceneManager.scene.cameras.length > 1;
			sceneManager.toggleCameraFolder(hasCameras);
			if (hasCameras) {
				sceneManager.updateCameraOptions();
			}

			// Toggle "disable_houdini_lighting" blade if no lights.
			const hasLights = result.lights.length > 0;
			sceneManager.toggleLightBlade(hasLights);
			if (hasLights) {
				sceneManager.currentSceneLights = result.lights;
				result.lights.forEach((light) => {
					light.setEnabled(
						!globalSettings.guiParams.lightingBindings.disable_houdini_lighting,
					);
				});
			} else {
				sceneManager.clearSceneLights();
			}

			// Toggle the Animation folder if no animations, otherwise populate.
			const hasAnimation = result.animationGroups.length > 0;
			sceneManager.toggleAnimationFolder(hasAnimation);
			if (hasAnimation) {
				populateAnimationFolder(result.animationGroups);
			}

			result.meshes.forEach((mesh) => {
				mesh.metadata = { imported: true };

				mesh.freezeWorldMatrix();
				mesh.alwaysSelectAsActiveMesh = true;

				// Shader compilation seems to be a major issue with performance.
				if (mesh.material && mesh.material instanceof BABYLON.PBRMaterial) {
					mesh.material.microSurface = 0.3;
				}

				// TODO Open panel to show current node's params? Fire off another render?
				mesh.actionManager = new BABYLON.ActionManager(sceneManager.scene);
				mesh.actionManager.registerAction(
					new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () =>
						console.log('Clicked the model...'),
					),
				);
			});

			toggleWireframe(globalSettings.guiParams.displayBindings.wireframe);
		})
		.catch((error) => {
			console.log('Error loading the GLB file:', error);
		});

	if (!sceneManager.isDefaultSkyboxLoaded) {
		setBackgroundTexture(globalSettings.guiParams.lightingBindings.environment);
		sceneManager.isDefaultSkyboxLoaded = true;
		applyPostLoadSkyboxSettings();
	}

	sceneManager.handleFreeze(true);
}

function clearModels() {
	// Dispose of any meshes previously loaded.
	sceneManager.scene.meshes.forEach((mesh) => {
		if (mesh.metadata && mesh.metadata.imported) {
			mesh.dispose();
		}
	});
}

async function initializeSceneManager() {
	sceneManager = new SceneManager();
	await sceneManager._initialize();
}

globalSettings = new DisplaySettings();
initializeSceneManager().then(() => {
	console.log('SceneManager has been initialized.');
	create_scene();
	onInit();
});
