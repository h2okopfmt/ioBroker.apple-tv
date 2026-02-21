'use strict';

/**
 * Central source of truth for the complete ioBroker state tree.
 * Each device gets this full tree created under its device ID.
 *
 * Structure: { channelName: { stateName: { type, role, read, write, def, ... } } }
 */
const STATE_DEFINITIONS = {
    info: {
        name:       { type: 'string',  role: 'info.name',             read: true, write: false, def: '' },
        model:      { type: 'string',  role: 'info.hardware',         read: true, write: false, def: '' },
        modelId:    { type: 'string',  role: 'value',                 read: true, write: false, def: '' },
        os:         { type: 'string',  role: 'value',                 read: true, write: false, def: '' },
        osVersion:  { type: 'string',  role: 'info.firmware',         read: true, write: false, def: '' },
        mac:        { type: 'string',  role: 'info.mac',              read: true, write: false, def: '' },
        address:    { type: 'string',  role: 'info.ip',               read: true, write: false, def: '' },
        identifier: { type: 'string',  role: 'value',                 read: true, write: false, def: '' },
        connected:  { type: 'boolean', role: 'indicator.reachable',   read: true, write: false, def: false },
        paired:     { type: 'boolean', role: 'indicator',             read: true, write: false, def: false },
    },

    power: {
        state: { type: 'boolean', role: 'switch.power', read: true, write: true, def: false },
    },

    remote: {
        up:           { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        down:         { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        left:         { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        right:        { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        select:       { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        menu:         { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        home:         { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        homeHold:     { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        topMenu:      { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        play:         { type: 'boolean', role: 'button.play',        read: false, write: true, def: false },
        pause:        { type: 'boolean', role: 'button.pause',       read: false, write: true, def: false },
        playPause:    { type: 'boolean', role: 'button.play.pause',  read: false, write: true, def: false },
        stop:         { type: 'boolean', role: 'button.stop',        read: false, write: true, def: false },
        next:         { type: 'boolean', role: 'button.next',        read: false, write: true, def: false },
        previous:     { type: 'boolean', role: 'button.prev',        read: false, write: true, def: false },
        skipForward:  { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        skipBackward: { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        volumeUp:     { type: 'boolean', role: 'button.volume.up',   read: false, write: true, def: false },
        volumeDown:   { type: 'boolean', role: 'button.volume.down', read: false, write: true, def: false },
        channelUp:    { type: 'boolean', role: 'button',             read: false, write: true, def: false },
        channelDown:  { type: 'boolean', role: 'button',             read: false, write: true, def: false },
    },

    playing: {
        title:       { type: 'string',  role: 'media.title',     read: true, write: false, def: '' },
        artist:      { type: 'string',  role: 'media.artist',    read: true, write: false, def: '' },
        album:       { type: 'string',  role: 'media.album',     read: true, write: false, def: '' },
        genre:       { type: 'string',  role: 'media.genre',     read: true, write: false, def: '' },
        mediaType: {
            type: 'string', role: 'media.type', read: true, write: false, def: 'unknown',
            states: { unknown: 'Unknown', music: 'Music', video: 'Video', tv: 'TV' },
        },
        deviceState: {
            type: 'string', role: 'media.state', read: true, write: false, def: 'idle',
            states: { idle: 'Idle', playing: 'Playing', paused: 'Paused', loading: 'Loading', seeking: 'Seeking' },
        },
        app:         { type: 'string',  role: 'value',           read: true, write: false, def: '' },
        appId:       { type: 'string',  role: 'value',           read: true, write: false, def: '' },
        position:    { type: 'number',  role: 'media.elapsed',   read: true, write: true,  def: 0, unit: 's' },
        duration:    { type: 'number',  role: 'media.duration',  read: true, write: false, def: 0, unit: 's' },
        shuffle: {
            type: 'string', role: 'value', read: true, write: false, def: 'off',
            states: { off: 'Off', songs: 'Songs', albums: 'Albums' },
        },
        repeat: {
            type: 'string', role: 'value', read: true, write: false, def: 'off',
            states: { off: 'Off', track: 'Track', all: 'All' },
        },
        artworkUrl:    { type: 'string', role: 'media.cover',        read: true, write: false, def: '' },
        artworkBase64: { type: 'string', role: 'media.cover.base64', read: true, write: false, def: '' },
    },

    apps: {
        list:      { type: 'string', role: 'json',  read: true,  write: false, def: '[]' },
        launch:    { type: 'string', role: 'value', read: false, write: true,  def: '' },
        current:   { type: 'string', role: 'value', read: true,  write: false, def: '' },
        currentId: { type: 'string', role: 'value', read: true,  write: false, def: '' },
    },

    volume: {
        level: { type: 'number', role: 'level.volume', read: true, write: false, def: 0, min: 0, max: 100 },
    },
};

module.exports = { STATE_DEFINITIONS };
