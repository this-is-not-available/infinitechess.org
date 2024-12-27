
// Import Start
import onlinegame from '../misc/onlinegame.js';
import gui from '../gui/gui.js';
import gamefileutility from '../../chess/util/gamefileutility.js';
import arrows from '../rendering/arrows.js';
import guipromotion from '../gui/guipromotion.js';
import guinavigation from '../gui/guinavigation.js';
import pieces from '../rendering/pieces.js';
import invites from '../misc/invites.js';
import guititle from '../gui/guititle.js';
import guipause from '../gui/guipause.js';
import input from '../input.js';
import miniimage from '../rendering/miniimage.js';
import clock from '../../chess/logic/clock.js';
import guiclock from '../gui/guiclock.js';
import piecesmodel from '../rendering/piecesmodel.js';
import movement from '../rendering/movement.js';
import selection from './selection.js';
import camera from '../rendering/camera.js';
import board from '../rendering/board.js';
import moveutil from '../../chess/util/moveutil.js';
import animation from '../rendering/animation.js';
import webgl from '../rendering/webgl.js';
import { gl } from '../rendering/webgl.js';
import perspective from '../rendering/perspective.js';
import highlightline from '../rendering/highlightline.js';
import transition from '../rendering/transition.js';
import options from '../rendering/options.js';
import copypastegame from './copypastegame.js';
import highlights from '../rendering/highlights.js';
import promotionlines from '../rendering/promotionlines.js';
import guigameinfo from '../gui/guigameinfo.js';
import loadbalancer from '../misc/loadbalancer.js';
import jsutil from '../../util/jsutil.js';
import winconutil from '../../chess/util/winconutil.js';
import sound from '../misc/sound.js';
import spritesheet from '../rendering/spritesheet.js';
import loadingscreen from '../gui/loadingscreen.js';
import movepiece from '../../chess/logic/movepiece.js';
import frametracker from '../rendering/frametracker.js';
import area from '../rendering/area.js';
import dragAnimation from '../rendering/draganimation.js';
// Import End

/** 
 * Type Definitions 
 * @typedef {import('../../chess/logic/gamefile.js').gamefile} gamefile
 */

"use strict";

/**
 * This script stores our currently loaded game,
 * and holds our update and render methods.
 */

/**
 * The currently loaded game. 
 * @type {gamefile}
 */
let gamefile;

/**
 * True when a game is currently loading and SVGs are being requested
 * or the spritesheet is being generated.
 */
let gameIsLoading = false;

/**
 * The timeout id of the timer that animates the latest-played
 * move when rejoining a game, after a short delay
 */
let animateLastMoveTimeoutID;
/**
 * The delay, in millis, until the latest-played
 * move is animated, after rejoining a game.
 */
const delayOfLatestMoveAnimationOnRejoinMillis = 150;



/**
 * Returns the gamefile currently loaded
 * @returns {gamefile} The current gamefile
 */
function getGamefile() {
	return gamefile;
}

function areInGame() {
	return gamefile !== undefined;
}

// Initiates textures, buffer models for rendering, and the title screen.
function init() {

	options.initTheme();

	guititle.open();

	board.recalcTileWidth_Pixels(); // Without this, the first touch tile is NaN
}

function updateVariablesAfterScreenResize() {
	// Recalculate scale at which 1 tile = 1 pixel       world-space                physical pixels
	movement.setScale_When1TileIs1Pixel_Physical((camera.getScreenBoundingBox(false).right * 2) / camera.canvas.width);
	movement.setScale_When1TileIs1Pixel_Virtual(movement.getScale_When1TileIs1Pixel_Physical() * camera.getPixelDensity());
	// console.log(`Screen width: ${camera.getScreenBoundingBox(false).right * 2}. Canvas width: ${camera.canvas.width}`)
}

// Update the game every single frame
function update() {
	if (gameIsLoading) return;

	if (!guinavigation.isCoordinateActive()) {
		if (input.isKeyDown('`')) options.toggleDeveloperMode();
		if (input.isKeyDown('2')) console.log(jsutil.deepCopyObject(gamefile));
		if (input.isKeyDown('m')) options.toggleFPS();
		if (gamefile?.mesh.locked && input.isKeyDown('z')) loadbalancer.setForceCalc(true);
	}

	if (gui.getScreen().includes('title')) updateTitleScreen();
	else updateBoard(); // Other screen, board is visible, update everything board related

	onlinegame.update();

	guinavigation.updateElement_Coords(); // Update the division on the screen displaying your current coordinates
	// options.update();
}

// Called within update() when on title screen
function updateTitleScreen() {
	movement.panBoard(); // Animate background if not afk

	invites.update();
}

// Called within update() when we are in a game (not title screen)
function updateBoard() {
	if (!guinavigation.isCoordinateActive()) {
		if (input.isKeyDown('1')) options.toggleEM(); // EDIT MODE TOGGLE
		if (input.isKeyDown('escape')) guipause.toggle();
		if (input.isKeyDown('tab')) guipause.callback_TogglePointers();
		if (input.isKeyDown('r')) piecesmodel.regenModel(gamefile, options.getPieceRegenColorArgs(), true);
		if (input.isKeyDown('n')) options.toggleNavigationBar();
	}

	const timeWinner = clock.update(gamefile);
	if (timeWinner) { // undefined if no clock has ran out
		gamefile.gameConclusion = `${timeWinner} time`;
		concludeGame();
	}
	guiclock.update(gamefile);
	miniimage.testIfToggled();
	animation.update();
	if (guipause.areWePaused() && !onlinegame.areInOnlineGame()) return;

	movement.updateNavControls(); // Update board dragging, and WASD to move, scroll to zoom
	movement.recalcPosition(); // Updates the board's position and scale according to its velocity
	transition.update();
	board.recalcVariables(); // Variables dependant on the board position & scale

	guinavigation.update();
	selection.update();
	arrows.update(); // NEEDS TO BE AFTER selection.update(), because the arrows model regeneration DEPENDS on the piece selected!
	movement.checkIfBoardDragged(); // ALSO depends on whether or not a piece is selected/being dragged!
	miniimage.genModel();
	highlightline.genModel();

	if (guipause.areWePaused()) return;

	movement.dragBoard(); // Calculate new board position if it's being dragged. Needs to be after updateNavControls()
} 

function render() {
	if (gameIsLoading) return; // Don't render anything while the game is loading.
    
	board.render();
	renderEverythingInGame();
}

function renderEverythingInGame() {
	if (gui.getScreen().includes('title')) return;

	input.renderMouse();

	webgl.executeWithDepthFunc_ALWAYS(() => {
		highlights.render(); // Needs to be before and underneath the pieces
		highlightline.render();
	});
    
	animation.renderTransparentSquares(); // Required to hide the piece currently being animated
	dragAnimation.renderTransparentSquare(); // Required to hide the piece currently being animated
	pieces.renderPiecesInGame(gamefile);
	animation.renderPieces();
	
	webgl.executeWithDepthFunc_ALWAYS(() => {
		promotionlines.render();
		selection.renderGhostPiece(); // If not after pieces.renderPiecesInGame(), wont render on top of existing pieces
		dragAnimation.renderPiece();
		arrows.renderThem();
		perspective.renderCrosshair();
	});
}

/**
 * Loads the provided gamefile onto the board.
 * Inits the promotion UI, mesh of all the pieces, and toggles miniimage rendering. (everything visual)
 * @param {gamefile} newGamefile - The gamefile
 */
async function loadGamefile(newGamefile) {
	if (gamefile) throw new Error("Must unloadGame() before loading a new one.");
	gameIsLoading = true;
	loadingscreen.open();

	gamefile = newGamefile;
	guiclock.set(newGamefile);
	guinavigation.update_MoveButtons();
	guigameinfo.updateWhosTurn(gamefile);

	try {
		await spritesheet.initSpritesheetForGame(gl, gamefile);
	} catch (e) { // An error ocurred during the fetching of piece svgs and spritesheet gen
		loadingscreen.onError();
	}
	guipromotion.initUI(gamefile.gameRules.promotionsAllowed);

	// Rewind one move so that we can animate the very final move.
	if (newGamefile.moveIndex > -1) movepiece.rewindMove(newGamefile,  { updateData: false, removeMove: false, animate: false });
	// A small delay to animate the very last move, so the loading screen
	// spinny pawn animation has time to fade away.
	animateLastMoveTimeoutID = setTimeout(movepiece.forwardToFront, delayOfLatestMoveAnimationOnRejoinMillis, gamefile, { flipTurn: false, updateProperties: false });

	// Disable miniimages and arrows if there's over 50K pieces. They render too slow.
	if (newGamefile.startSnapshot.pieceCount >= gamefileutility.pieceCountToDisableCheckmate) {
		miniimage.disable();
		arrows.setMode(0); // Disables arrows
	} else miniimage.enable();

	// Regenerate the mesh of all the pieces.
	piecesmodel.regenModel(gamefile, options.getPieceRegenColorArgs());

	// Immediately conclude the game if we loaded a game that's over already
	if (gamefileutility.isGameOver(gamefile)) {
		concludeGame();
		onlinegame.requestRemovalFromPlayersInActiveGames();
	}

	initListeners();

	gameIsLoading = false;
	loadingscreen.close();
	// Required so the first frame of the game & tiles is rendered once the animation page fades away
	frametracker.onVisualChange();

	startStartingTransition();
}

/**
 * Sets the camera to the recentered position, plus a little zoomed in.
 * THEN transitions to normal zoom.
 */
function startStartingTransition() {
	const centerArea = area.calculateFromUnpaddedBox(gamefile.startSnapshot.box);
	movement.setPositionToArea(centerArea);
	movement.setBoardScale(movement.getBoardScale() * 1.75);
	guinavigation.callback_Recenter();
}

/** The canvas will no longer render the current game */
function unloadGame() {
	// Terminate the mesh algorithm.
	gamefile.mesh.terminateIfGenerating();
	gamefile = undefined;

	selection.unselectPiece();
	transition.eraseTelHist();
	board.updateTheme(); // Resets the board color (the color changes when checkmate happens)
	closeListeners();

	// Clock data is unloaded with gamefile now, just need to reset gui. Not our problem ¯\_(ツ)_/¯
	guiclock.resetClocks();

	spritesheet.deleteSpritesheet();
	guipromotion.resetUI();

	// Stop the timer that animates the latest-played move when rejoining a game, after a short delay
	clearTimeout(animateLastMoveTimeoutID);
	animateLastMoveTimeoutID = undefined;
}

/** Called when a game is loaded, loads the event listeners for when we are in a game. */
function initListeners() {
	document.addEventListener('copy', copypastegame.callbackCopy);
	document.addEventListener('paste', copypastegame.callbackPaste);
}

/** Called when a game is unloaded, closes the event listeners for being in a game. */
function closeListeners() {
	document.removeEventListener('copy', copypastegame.callbackCopy);
	document.removeEventListener('paste', copypastegame.callbackPaste);
}

/**
 * Ends the game. Call this when the game is over by the used win condition.
 * Stops the clocks, darkens the board, displays who won, plays a sound effect.
 */
function concludeGame() {
	if (winconutil.isGameConclusionDecisive(gamefile.gameConclusion)) moveutil.flagLastMoveAsMate(gamefile);
	clock.endGame(gamefile);
	guiclock.stopClocks(gamefile);
	board.darkenColor();
	guigameinfo.gameEnd(gamefile.gameConclusion);
	onlinegame.onGameConclude();

	const delayToPlayConcludeSoundSecs = 0.65;
	if (!onlinegame.areInOnlineGame()) {
		if (!gamefile.gameConclusion.includes('draw')) sound.playSound_win(delayToPlayConcludeSoundSecs);
		else sound.playSound_draw(delayToPlayConcludeSoundSecs);
	} else { // In online game
		if (gamefile.gameConclusion.includes(onlinegame.getOurColor())) sound.playSound_win(delayToPlayConcludeSoundSecs);
		else if (gamefile.gameConclusion.includes('draw') || gamefile.gameConclusion.includes('aborted')) sound.playSound_draw(delayToPlayConcludeSoundSecs);
		else sound.playSound_loss(delayToPlayConcludeSoundSecs);
	}
	
	// Set the Result and Condition metadata
	gamefileutility.setTerminationMetadata(gamefile);

	selection.unselectPiece();
	guipause.updateTextOfMainMenuButton();
}


export default {
	getGamefile,
	areInGame,
	init,
	updateVariablesAfterScreenResize,
	update,
	render,
	loadGamefile,
	unloadGame,
	concludeGame,
};