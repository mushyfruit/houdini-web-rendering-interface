export const DEFAULT_SKYBOXES = {
	'Artist Workshop': 'artist_workshop.env',
	'Overcast Sky': 'overcast_sky.env',
	'Photo Studio': 'photo_studio_small.env',
	Industrial: 'industrial_pipe_and_valve.env',
	'Aircraft Workshop': 'aircraft_workshop.env',
};

export const DISPLAY_UI_PARAMS = {
	ui: {
		pane: {
			expanded: true,
		},
		display: {
			expanded: true,
		},
		lighting: {
			expanded: true,
		},
	},
	displayBindings: {
		background: true,
		wireframe: false,
		grid: false,
		grid_size: 8,
		autorotate: false,
		autorotate_speed: 0.1,
		background_color: 'rgb(51, 51, 76)',
	},
	lightingBindings: {
		// Always default to first entry to skyboxes mapping.
		environment: Object.entries(DEFAULT_SKYBOXES)[0][1],
		environment_exposure: 1,
		environment_blur: 0.1,
		environment_rotation: 0,
		rotate_environment: false,
		rotate_speed: 0,
	},
};
