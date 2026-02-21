'use strict';

/**
 * Mapping from ioBroker state names (camelCase) to pyatv command names (snake_case).
 */
const PYATV_COMMAND_MAP = {
    up:           'up',
    down:         'down',
    left:         'left',
    right:        'right',
    select:       'select',
    menu:         'menu',
    home:         'home',
    homeHold:     'home_hold',
    topMenu:      'top_menu',
    play:         'play',
    pause:        'pause',
    playPause:    'play_pause',
    stop:         'stop',
    next:         'next',
    previous:     'previous',
    skipForward:  'skip_forward',
    skipBackward: 'skip_backward',
    volumeUp:     'volume_up',
    volumeDown:   'volume_down',
    channelUp:    'channel_up',
    channelDown:  'channel_down',
};

/**
 * Mapping from ioBroker state names to node-appletv-x Key enum values.
 */
const NODE_KEY_MAP = {
    up:        'Up',
    down:      'Down',
    left:      'Left',
    right:     'Right',
    select:    'Select',
    menu:      'Menu',
    home:      'TV',
    homeHold:  'LongTV',
    play:      'Play',
    pause:     'Pause',
    next:      'Next',
    previous:  'Previous',
};

const DEFAULT_POLLING_INTERVAL = 10;   // seconds
const DEFAULT_ARTWORK_INTERVAL = 30;   // seconds
const RECONNECT_BASE_DELAY = 5000;     // ms
const RECONNECT_MAX_DELAY = 300000;    // 5 minutes in ms
const MAX_RECONNECT_ATTEMPTS = 10;
const ATVSCRIPT_TIMEOUT = 15000;       // ms
const ATVSCRIPT_SCAN_TIMEOUT = 30000;  // ms

module.exports = {
    PYATV_COMMAND_MAP,
    NODE_KEY_MAP,
    DEFAULT_POLLING_INTERVAL,
    DEFAULT_ARTWORK_INTERVAL,
    RECONNECT_BASE_DELAY,
    RECONNECT_MAX_DELAY,
    MAX_RECONNECT_ATTEMPTS,
    ATVSCRIPT_TIMEOUT,
    ATVSCRIPT_SCAN_TIMEOUT,
};
