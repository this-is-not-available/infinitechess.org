import { format } from 'date-fns';
import { v4 as uuid } from 'uuid';

import { promises as fsPromises } from 'fs';
import path from 'path';

import { getClientIP } from '../utility/IP.js';
import socketUtility from '../socket/socketUtility.js';
import { ensureDirectoryExists } from '../utility/fileUtils.js';

import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {import("../socket/socketUtility.js").CustomWebSocket} CustomWebSocket */

const giveLoggedItemsUUID = false;


/**
 * Logs the provided message by appending a line to the end of the specified log file.
 * @param {string} message - The message to log.
 * @param {string} logName - The name of the log file.
 * @param {Object} [options] - Optional parameters.
 * @param {boolean} [options.print] - If true, prints the message to the console as an error.
 */
const logEvents = async(message, logName, { print } = {}) => {
	if (typeof message !== 'string') return console.trace("Cannot log message when it is not a string.");
	if (!logName) return console.trace("Log name MUST be provided when logging an event!");

	if (print) console.error(message);
	const dateTime = format(new Date(), 'yyyy/MM/dd  HH:mm:ss');
	const logItem = giveLoggedItemsUUID ? `${dateTime}   ${uuid()}   ${message}\n` // With unique UUID
                                        : `${dateTime}   ${message}\n`;
    
	try {
		const logsPath = path.join(__dirname, '..', '..', '..', 'logs');
		ensureDirectoryExists(logsPath);
		await fsPromises.appendFile(path.join(logsPath, logName), logItem);
	} catch (err) {
		console.log(err);
	}
};

/**
 * Middleware that logs the incoming request, then calls `next()`.
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @param {Function} next - The function to call, once finished, to continue down the middleware waterfall.
 */
const logger = (req, res, next) => {
	const clientIP = getClientIP(req);

	const origin = req.headers.origin || 'Unknown origin';

	let logThis = `${origin}   ${clientIP}   ${req.method}   ${req.url}   ${req.headers['user-agent']}`;
	// Delete passwords from incoming form data
	let sensoredBody;
	if (JSON.stringify(req.body) !== '{}') { // Not an empty object
		sensoredBody = { ...req.body };
		delete sensoredBody.password;
		delete sensoredBody.username; // Since IP's are logged with each request, If you know a deleted account's username, it can be indirectly traced to their IP if we don't delete them here.
		delete sensoredBody.email;
		logThis += `\n${JSON.stringify(sensoredBody)}`;
	}

	logEvents(logThis, 'reqLog.txt');
    
	next(); // Continue to next middleware
};

/**
 * Logs websocket connection upgrade requests into `wsInLog.txt`
 * @param {Object} req - The request object
 * @param {CustomWebSocket} ws - The websocket object
 */
function logWebsocketStart(req, ws) {
	const socketID = ws.metadata.id;
	const stringifiedSocketMetadata = socketUtility.stringifySocketMetadata(ws);
	const userAgent = req.headers['user-agent'];
	// const userAgent = ws.metadata.userAgent;
	const logThis = `Opened socket of ID "${socketID}": ${stringifiedSocketMetadata}   User agent: ${userAgent}`;
	logEvents(logThis, 'wsInLog.txt');
}

/**
 * Logs incoming websocket messages into `wsInLog.txt`
 * @param {CustomWebSocket} ws - The websocket object
 * @param {string} messageData - The raw data of the incoming message, as a string
 */
function logReqWebsocketIn(ws, messageData) {
	const socketID = ws.metadata.id;
	const logThis = `From socket of ID "${socketID}":   ${messageData}`;
	logEvents(logThis, 'wsInLog.txt');
}

/**
 * Logs outgoing websocket messages into `wsOutLog.txt`
 * @param {CustomWebSocket} ws - The websocket object
 * @param {string} messageData - The raw data of the outgoing message, as a string
 */
function logReqWebsocketOut(ws, messageData) {
	const socketID = ws.metadata.id;
	const logThis = `To socket of ID "${socketID}":   ${messageData}`;
	logEvents(logThis, 'wsOutLog.txt');
}

export {
	logEvents,
	logger,
	logWebsocketStart,
	logReqWebsocketIn,
	logReqWebsocketOut
};
