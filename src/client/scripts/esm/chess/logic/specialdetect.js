
// Import Start
import gamefileutility from '../util/gamefileutility.js';
import organizedlines from './organizedlines.js';
import checkdetection from './checkdetection.js';
import colorutil from '../util/colorutil.js';
import jsutil from '../../util/jsutil.js';
import coordutil from '../util/coordutil.js';
import gamerules from '../variants/gamerules.js';
import math from '../../util/math.js';
import fivedimensionalpromote from './fivedimensionalpromote.js';
// Import End

/** 
 * Type Definitions 
 * @typedef {import('./gamefile.js').gamefile} gamefile
 * @typedef {import('../util/moveutil.js').Move} Move
*/

"use strict";

/**
 * This detects if special moves are legal.
 * Does NOT execute the moves!
 */

/** All types of special moves that exist, for iterating through. */
const allSpecials = ['enpassant','promotion','castle'];

/** Returns the list of all special moves that exist, for iterating. */
function getAllSpecialMoves() { return allSpecials; }


/**
 * Returns a copy of the methods needed to calculate a piece's legal special moves.
 * These are attached to the gamefile, as each gamefile could have unique rules
 * for determining legal moves (parameters can be added to this function).
 * @returns {Object} An object containing the methods for calculating legal special moves.
 */
function getSpecialMoves() {
	return {
		"kings": kings,
		"royalCentaurs": kings,
		"pawns": pawns,
		"roses": roses,
	};
}

// EVERY one of these functions needs to include enough information in the special move tag
// to be able to undo any of them!

/**
 * Appends legal king special moves to the provided legal individual moves list. (castling)
 * @param {gamefile} gamefile - The gamefile
 * @param {number[]} coords - Coordinates of the king selected
 * @param {string} color - The color of the king selected
 * @param {array[]} individualMoves - The legal individual moves calculated so far
 */
function kings(gamefile, coords, color, individualMoves) {
	if (!doesPieceHaveSpecialRight(gamefile, coords)) return; // King doesn't have castling rights

	const x = coords[0];
	const y = coords[1];
	const key = organizedlines.getKeyFromLine([1,0],coords);
	const row = gamefile.piecesOrganizedByLines['1,0'][key];


	// Castling. What makes a castle legal?

	let leftLegal = true;
	let rightLegal = true;

	// 1. There is a piece directly left or right of us that has
	// it's special move rights, that is atleast 3 squares away.

	let left = -Infinity; // Piece directly left of king. (Infinity if none)
	let right = Infinity; // Piece directly right of king. (Infinity if none)
	for (let i = 0; i < row.length; i++) {
		const thisPiece = row[i]; // { type, coords }
		const thisCoord = thisPiece.coords;

		if (thisCoord[0] < x && thisCoord[0] > left) left = thisCoord[0];
		else if (thisCoord[0] > x && thisCoord[0] < right) right = thisCoord[0];
	}

	const leftDist = x - left;
	const rightDist = right - x;
	const leftCoord = [left, y];
	const rightCoord = [right, y];
	const leftPieceType = gamefileutility.getPieceTypeAtCoords(gamefile, leftCoord);
	const rightPieceType = gamefileutility.getPieceTypeAtCoords(gamefile, rightCoord);
	const leftColor = leftPieceType ? colorutil.getPieceColorFromType(leftPieceType) : undefined;
	const rightColor = rightPieceType ? colorutil.getPieceColorFromType(rightPieceType) : undefined;

	if (left === -Infinity || leftDist < 3 || !doesPieceHaveSpecialRight(gamefile, leftCoord) || leftColor !== color || leftPieceType.startsWith('pawns')) leftLegal = false;
	if (right === Infinity || rightDist < 3 || !doesPieceHaveSpecialRight(gamefile, rightCoord) || rightColor !== color || rightPieceType.startsWith('pawns')) rightLegal = false;
	if (!leftLegal && !rightLegal) return;

	// 2. IF USING CHECKMATE: The king must not currently be in check,
	// AND The square the king passes through must not be a check.
	// The square the king lands on will be tested later, within  legalmoves.calculate()

	const oppositeColor = colorutil.getOppositeColor(color);
	if (gamerules.doesColorHaveWinCondition(gamefile.gameRules, oppositeColor, 'checkmate')) {
		if (gamefile.inCheck) return; // Not legal if in check

		// Simulate the space in-between

		const king = gamefileutility.getPieceAtCoords(gamefile, coords); // { type, index, coords }
		if (leftLegal) {
			const middleSquare = [x - 1, y];
			if (checkdetection.doesMovePutInCheck(gamefile, king, middleSquare, color)) leftLegal = false;
		} if (rightLegal) {
			const middleSquare = [x + 1, y];
			if (checkdetection.doesMovePutInCheck(gamefile, king, middleSquare, color)) rightLegal = false;
		}
	}

	// Add move

	if (leftLegal) {
		const specialMove = [coords[0] - 2, coords[1]];
		specialMove.castle = { dir: -1, coord: leftCoord};
		individualMoves.push(specialMove);
	}

	if (rightLegal) {
		const specialMove = [coords[0] + 2, coords[1]];
		specialMove.castle = { dir: 1, coord: rightCoord};
		individualMoves.push(specialMove);
	}
}

/**
 * Appends legal pawn moves to the provided legal individual moves list.
 * This also is in charge of adding single-push, double-push, and capturing
 * pawn moves, even though those don't need a special move flag.
 * @param {gamefile} gamefile - The gamefile
 * @param {number[]} coords - Coordinates of the pawn selected
 * @param {string} color - The color of the pawn selected
 * @param {array[]} individualMoves - The legal individual moves calculated so far
 */
function pawns(gamefile, coords, color, individualMoves) {

	// White and black pawns move and capture in opposite directions.
	const yOneorNegOne = color === 'white' ? 1 : -1; 

	// How do we go about calculating a pawn's legal moves?

	// 1. It can move forward if there is no piece there

	// Is there a piece in front of it?
	const coordsInFront = [coords[0], coords[1] + yOneorNegOne];
	if (!gamefileutility.getPieceTypeAtCoords(gamefile, coordsInFront)) {
		individualMoves.push(coordsInFront); // No piece, add the move

		// Is the double push legal?
		const doublePushCoord = [coordsInFront[0], coordsInFront[1] + yOneorNegOne];
		const pieceAtCoords = gamefileutility.getPieceTypeAtCoords(gamefile, doublePushCoord);
		if (!pieceAtCoords && doesPieceHaveSpecialRight(gamefile, coords)) individualMoves.push(doublePushCoord); // Add the double push!
	}

	// 2. It can capture diagonally if there are opponent pieces there

	const coordsToCapture = [
        [coords[0] - 1, coords[1] + yOneorNegOne],
        [coords[0] + 1, coords[1] + yOneorNegOne]
    ];
	for (let i = 0; i < 2; i++) {
		const thisCoordsToCapture = coordsToCapture[i];

		// Is there an enemy piece at this coords?
		const pieceAtCoords = gamefileutility.getPieceTypeAtCoords(gamefile, thisCoordsToCapture);
		if (!pieceAtCoords) continue; // No piece, skip

		// There is a piece. Make sure it's a different color
		const colorOfPiece = colorutil.getPieceColorFromType(pieceAtCoords);
		if (color === colorOfPiece) continue; // Same color, don't add the capture

		// Make sure it isn't a void
		if (pieceAtCoords === 'voidsN') continue;

		individualMoves.push(thisCoordsToCapture); // Good to add the capture!
	}

	// 3. It can capture en passant if a pawn next to it just pushed twice.
	addPossibleEnPassant(gamefile, individualMoves, coords, color);
}

/**
 * Appends legal enpassant capture to the selected pawn's provided individual moves.
 * @param {gamefile} gamefile - The gamefile
 * @param {array[]} individualMoves - The running list of legal individual moves
 * @param {number[]} coords - The coordinates of the pawn selected, [x,y]
 * @param {string} color - The color of the pawn selected
 */
// If it can capture en passant, the move is appended to  legalmoves
function addPossibleEnPassant(gamefile, individualMoves, coords, color) {
	if (!gamefile.enpassant) return; // No enpassant flag on the game, no enpassant possible

	const xLandDiff = gamefile.enpassant[0] - coords[0];
	const oneOrNegOne = color === 'white' ? 1 : -1;
	if (Math.abs(xLandDiff) !== 1) return; // Not immediately left or right of us
	if (coords[1] + oneOrNegOne !== gamefile.enpassant[1]) return; // Not one in front of us

	const captureSquare = [coords[0] + xLandDiff, coords[1] + oneOrNegOne];

	const capturedPieceSquare = [coords[0] + xLandDiff, coords[1]];
	const capturedPieceType = gamefileutility.getPieceTypeAtCoords(gamefile, capturedPieceSquare);
	// cannot capture nothing en passant
	if (!capturedPieceType) return;
	// cannot capture own piece en passant
	if (color === colorutil.getPieceColorFromType(capturedPieceType)) return;

	// It is capturable en passant!

	// Extra check to make sure there's no piece (bug if so)
	if (gamefileutility.getPieceTypeAtCoords(gamefile, captureSquare)) return console.error("We cannot capture onpassant onto a square with an existing piece! " + captureSquare);

	// TAG THIS MOVE as an en passant capture!! gamefile looks for this tag
	// on the individual move to detect en passant captures and to know what piece to delete
	captureSquare.enpassant = -oneOrNegOne;
	individualMoves.push(captureSquare);
}

/**
 * Appends legal moves for the rose piece to the provided legal individual moves list.
 * @param {gamefile} gamefile - The gamefile
 * @param {number[]} coords - Coordinates of the rose selected
 * @param {string} color - The color of the rose selected
 * @param {array[]} individualMoves - The legal individual moves calculated so far
 */
function roses(gamefile, coords, color, individualMoves) {
	const movements = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]]; // Counter-clockwise
	const directions = [1, -1]; // Counter-clockwise and clockwise directions

	for (let i = 0; i < movements.length; i++) {
		for (const direction of directions) {
			let currentCoord = coordutil.copyCoords(coords);
			let b = i;
			for (let c = 0; c < movements.length - 1; c++) { // Iterate 7 times, since we can't land on the square we started
				const movement = movements[math.posMod(b, movements.length)];
				currentCoord = coordutil.addCoordinates(currentCoord, movement);
				const pieceOnSquare = gamefileutility.getPieceAtCoords(gamefile, currentCoord); // { type, index, coords }
				if (pieceOnSquare) {
					const colorOfPiece = colorutil.getPieceColorFromType(pieceOnSquare.type);
					// eslint-disable-next-line max-depth
					if (color !== colorOfPiece) appendCoordToIndividuals(individualMoves, currentCoord); // Capture is legal
					break;
				}
				// There is not a piece
				appendCoordToIndividuals(individualMoves, currentCoord);
				b += direction; // Update 'b' for the next iteration
			}
		}
	}
}

/**
 * Appends a coordinate to the individual moves list if it's not already present.
 * @param {array[]} individualMoves - The list of individual moves.
 * @param {number[]} newCoord - The coordinate to append [x, y].
 */
function appendCoordToIndividuals(individualMoves, newCoord) {
	for (let i = 0; i < individualMoves.length; i++) {
		const coord = individualMoves[i];
		if (coordutil.areCoordsEqual(coord, newCoord)) return;
	}
	individualMoves.push(newCoord);
}

/**
 * Tests if the piece at the given coordinates has it's special move rights.
 * @param {gamefile} gamefile - The gamefile
 * @param {number[]} coords - The coordinates of the piece
 * @returns {boolean} *true* if it has it's special move rights.
 */
function doesPieceHaveSpecialRight(gamefile, coords) {
	const key = coordutil.getKeyFromCoords(coords);
	return gamefile.specialRights[key];
}

// Returns true if the type is a pawn and the coords it moved to is a promotion line

/**
 * Returns true if a pawn moved onto a promotion line.
 * @param {string} type 
 * @param {number[]} coordsClicked 
 * @returns {boolean}
 */
function isPawnPromotion(gamefile, type, coordsClicked) {
	if (!type.startsWith('pawns')) return false;
	if (gamefile.metadata.Variant === "5D_Chess") return fivedimensionalpromote.fivedimensionalpromote(gamefile, type, coordsClicked); /* Five dimensional promotion is
																														   hardcoded for now, this should be
																														   replaced with multiple promotion
																														   lines when they are finished.
																														 */
	if (!gamefile.gameRules.promotionRanks) return false; // This game doesn't have promotion.

	const color = colorutil.getPieceColorFromType(type);
	const promotionRank = color === 'white' ? gamefile.gameRules.promotionRanks[0]
        : color === 'black' ? gamefile.gameRules.promotionRanks[1]
            : undefined; // Can neutral pawns promote???

	if (coordsClicked[1] === promotionRank) return true;

	return false;
}

/**
 * Transfers any special move flags from the provided coordinates to the move.
 * @param {number[]} coords - The coordinates
 * @param {Move} move - The move
 */
function transferSpecialFlags_FromCoordsToMove(coords, move) {
	for (const special of allSpecials) {
		if (coords[special]) {
			move[special] = jsutil.deepCopyObject(coords[special]);
		}
	}
}

/**
 * Transfers any special move flags from the provided move to the coordinates.
 * @param {number[]} coords - The coordinates
 * @param {Move} move - The move
 */
function transferSpecialFlags_FromMoveToCoords(move, coords) {
	for (const special of allSpecials) {
		if (move[special]) coords[special] = jsutil.deepCopyObject(move[special]);
	}
}

/**
 * Transfers any special move flags from the one pair of coordinates to another.
 * @param {number[]} srcCoords - The source coordinates
 * @param {number[]} destCoords - The destination coordinates
 */
function transferSpecialFlags_FromCoordsToCoords(srcCoords, destCoords) {
	for (const special of allSpecials) {
		if (srcCoords[special] !== undefined) destCoords[special] = jsutil.deepCopyObject(srcCoords[special]);
	}
}

export default {
	getAllSpecialMoves,
	getSpecialMoves,
	isPawnPromotion,
	transferSpecialFlags_FromCoordsToMove,
	transferSpecialFlags_FromMoveToCoords,
	transferSpecialFlags_FromCoordsToCoords
};