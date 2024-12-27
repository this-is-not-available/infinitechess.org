import gamefileutility from "../../src/client/scripts/esm/chess/util/gamefileutility";

const engine = (function() {
	/**
	 * returns all intersections of diagonal, horizontal and vertical lines emitting from all pieces.
	 * meant to represent squares the engine would care about.
	 * @param {gamefile} gamefile - gamefile
	 */
	function getIntersections(gamefile) {

		const intersections = new Set();

		const diagonalLineArr = []; // an array holding arrays of the slope and the y-intercept of each diagonal line respectfully. this will help us determine the intersections between them
		const xSet = new Set();
		const ySet = new Set();
		// generate the line array
		for (const i in gamefile.piecesOrganizedByKey) {
			const [x, y] = math.getCoordsFromKey(i);
			xSet.add(x);
			ySet.add(y);
			const firstLine = [1, y - x];
			const secondLine = [-1, y + x];
			diagonalLineArr.push(firstLine, secondLine);
		}

		for (let i = 0; i < diagonalLineArr.length; i++) {
			const [m1, b1] = diagonalLineArr[i];

			// calculate its intersections with all horizontal lines
			for (const y of ySet) {
				// should be
				// intersections.add([(y - b1) / m1, y]);
				// but because m1 is either 1 or -1 multiplying is the same as dividing
				// and dividing is known to be slower.
				intersections.add(`${(y - b1) * m1},${y}`);
			}

			// calculate its intersections with all vertical lines
			for (const x of xSet) {
				intersections.add(`${x},${m1 * x + b1}`);
			}

			for (let j = i + 1; j < diagonalLineArr.length; j++) {
				const [m2, b2] = diagonalLineArr[j];

				const intersectionX = (b2 - b1) / (m1 - m2);
				if (!isFinite(intersectionX) || !Number.isInteger(intersectionX)) continue;
				const intersectionY = m1 * intersectionX + b1;
				intersections.add(`${intersectionX},${intersectionY}`);
			}
		}

		return intersections;
	}

	/**
	 * returns all legal moves that move into an intersection of pieces (see `engine.getIntersections`)
	 * mainly used to get the moves the engine would consider aka look into in its search.
	 * @param {gamefile} gamefile - gamefile
	 * @returns {Move[]} - array of considered moves
	 */
	function getConsideredMoves(gamefile) {
		const moves = [];
		const intersections = getIntersections(gamefile);
		for (const type in gamefile.ourPieces) {
			if (gamefile.whosTurn !== math.getPieceColorFromType(type)) continue;
			for (const coords of gamefile.ourPieces[type]) {
				if (!coords) continue;
				const piece = gamefileutility.getPieceFromTypeAndCoords(gamefile, type, coords);
				const legalMoves = legalmoves.calculate(gamefile, piece);
				for (const intersection of intersections) {
					const intersectionCoords = math.getCoordsFromKey(intersection);
					if (legalmoves.checkIfMoveLegal(legalMoves, coords, intersectionCoords)) {
						const move = { type, startCoords: coords, endCoords: intersectionCoords };
						// legalmoves.checkIfMoveLegal transfers special flags from startCoords to endCoords
						// we want our move to have the special flags so we will transfer them to it.
						specialdetect.transferSpecialFlags_FromCoordsToMove(intersectionCoords, move);
						moves.push(move);
					}
				}
			}
		}
		return moves;
	}

	/**
	 * evaluation function for a lone black king. (designed for Practice Mode)
	 * @param {gamefile} gamefile - the gamefile
	 * @returns {number} - the evaluation of the position (gamefile)
	 */
	function loneBlackKingEval(gamefile) {
		let evaluation = 0;
		const kingCoords = gamefile.ourPieces.kingsB[0];
		const piece = gamefileutility.getPieceFromTypeAndCoords(gamefile, 'kingsB', kingCoords);
		const kingLegalMoves = legalmoves.calculate(gamefile, piece);
		evaluation += kingLegalMoves.individual.length;

		// add a point to the evaluation for each piece the king is attacking.
		for (let x = -1; x <= 1; x++) {
			for (let y = -1; y <= 1; y++) {
				if (x == 0 && y == 0) continue;
				if (gamefileutility.getPieceAtCoords(gamefile, [kingCoords[0] + x, kingCoords[1] + y])) evaluation += 1;
			}
		}
		const opponentPieceCount = gamefileutility.getPieceCountOfColor(gamefile, 'white');
		evaluation -= opponentPieceCount * 100;

		// Pieces that can put a king in some sort of a box or a cage (for example two rooks can put a king in a cage)
		const boxerWhitePieces = ['queensW', 'chancellorsW', 'rooksW', 'royalQueensW'];
		const whitePiecesWeightTable = {
			kingsW: {weight: 4, distanceFunction: math.chebyshevDistance},
			guardsW: {weight: 4, distanceFunction: math.chebyshevDistance},
			knightsW: {weight: 3, distanceFunction: math.chebyshevDistance},
			hawksW: {weight: 2, distanceFunction: math.chebyshevDistance},
		};
		let boxerWhitePieceCount = 0;
		for (const boxerWhitePiece of boxerWhitePieces) {
			boxerWhitePieceCount += gamefileutility.getPieceCountOfType(gamefile, boxerWhitePiece);
			if (boxerWhitePieceCount > 1) {
				for (const bWP of boxerWhitePieces) {
					whitePiecesWeightTable[bWP] = {weight: 1, distanceFunction: math.manhattanDistance};
				}
				break;
			}
		}
		for (const type of pieces.white) {
			if (!(type in whitePiecesWeightTable) || !gamefileutility.getPieceCountOfType(gamefile, type)) continue;
			const pieceWeightTable = whitePiecesWeightTable[type];

			for (const pieceCoords of gamefile.ourPieces[type]) {
				if (!pieceCoords) continue;
				// calculate the distance between king and the piece
				// multiply it by the piece weight and add it to the evaluation
				evaluation += pieceWeightTable.distanceFunction(pieceCoords, kingCoords) * pieceWeightTable.weight;
			}
		}
		return evaluation;
	}

	/**
	 * Gets the legal moves of the black king (first one if there's multiple)
	 * @param {gamefile} gamefile - gamefile
	 * @returns {Move[]} - legal moves for the black king (first one if there's multiple)
	 */
	function getBlackKingLegalMoves(gamefile) {
		const kingCoords = gamefile.ourPieces.kingsB[0];
		const kingPiece = gamefileutility.getPieceAtCoords(gamefile, gamefile.ourPieces.kingsB[0]);
		const { individual } = legalmoves.calculate(gamefile, kingPiece);
		return individual.map(x => ({type: 'kingsB', startCoords: kingCoords, endCoords: x}));
	}

	/**
	 * Searches the tree of possible lines with the negamax algorithm with alpha-beta pruning
	 * @param {gamefile} gamefile - the gamefile
	 * @param {number} depth - how much moves deep the algorithm will search
	 * @param {number} alpha - the alpha value (lower bound)
	 * @param {number} beta - the beta value (upper bound)
	 * @param {number} colorNum - a number representing the number (1 if black, -1 if white)
	 * @returns {number} - the score of the given position (gamefile) after searching with depth of `depth`
	 */
	function negamax(gamefile, depth, alpha, beta, colorNum) {
		// return -Infinity if white manages to checkmate in this line to discourage the engine from choosing this move if it could
		// return Infinity if black manages to draw in this line to make engine pick this or other moves that draw
		// multiply those two by color to make them fit which color's turn it is
		// put this here instead of evaluation function to end search immediately
		const gameConclusion = wincondition.getGameConclusion(gamefile);
		if (gameConclusion == 'white checkmate') return colorNum * -Infinity;
		if (gameConclusion && gameConclusion.startsWith('draw')) return colorNum * Infinity;

		// return evaluation if depth is zero
		if (depth == 0) return colorNum * loneBlackKingEval(gamefile);

		// if its black's turn get all king legal moves
		// if its white's turn get the considered moves. aka moves that move into an intersection
		const moves = colorNum == 1 ? getBlackKingLegalMoves(gamefile) : getConsideredMoves(gamefile);
		for (const move of moves) {
			movepiece.makeMove(gamefile, move, {
				pushClock: false,
				animate: false,
				updateData: false,
				simulated: true,
			});
			const score = -negamax(gamefile, depth - 1, -beta, -alpha, -colorNum);
			movepiece.rewindMove(gamefile, {
				updateData: false,
				animate: false
			});
			if (score >= beta) {
				// beta cut-off
				return beta;
			}
			if (score > alpha) {
				// found better move
				alpha = score;
			}
		}
		return alpha;
	}
	/**
	 * runs negamax search on every move and returns the move with the highest score. returns a random move if checkmate is forced
	 * @param {gamefile} gamefile - the gamefile
	 * @param {number} depth - how much moves deep the search will go
	 * @returns {Move} - the move with the highest score or a random move if checkmate is forced
	 */
	function calculate(gamefile, depth) {
		const moves = getBlackKingLegalMoves(gamefile);
		let bestScore = -Infinity;
		// choose a random move. if the search returns -Infinity (means checkmate is forced) play this instead
		let bestMove = moves[Math.floor(Math.random() * moves.length)];
		for (const move of moves) {
			movepiece.makeMove(gamefile, move, {
				pushClock: false,
				animate: false,
				updateData: false,
				simulated: true,
			});
			const score = -negamax(gamefile, depth - 1, -Infinity, Infinity, -1);
			movepiece.rewindMove(gamefile, {
				updateData: false,
				animate: false
			});
			if (score > bestScore) {
				bestScore = score;
				bestMove = move;
			}
		}
		return bestMove;
	}

	return Object.freeze({
		getIntersections,
		getConsideredMoves,
		negamax,
		calculate
	});
})();