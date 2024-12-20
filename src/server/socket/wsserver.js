import { WebSocketServer as Server, WebSocket } from 'ws';
import { verifyJWTWebSocket } from '../middleware/verifyJWT.js';
import { rateLimitWebSocket } from '../middleware/rateLimit.js';
import { logWebsocketStart, logReqWebsocketIn, logReqWebsocketOut, logEvents } from '../middleware/logEvents.js';
import { DEV_BUILD, HOST_NAME, GAME_VERSION, simulatedWebsocketLatencyMillis } from '../config/config.js';

import uuid from '../../client/scripts/esm/util/uuid.js';
const { genUniqueID, generateNumbID } = uuid;
import wsutility from '../game/wsutility.js';
import { handleGameRoute } from '../game/gamemanager/gamerouter.js';
import { handleInviteRoute } from '../game/invitesmanager/invitesrouter.js';
import { unsubClientFromGameBySocket } from '../game/gamemanager/gamemanager.js';
import { subToInvitesList, unsubFromInvitesList, userHasInvite } from '../game/invitesmanager/invitesmanager.js';
import { ensureJSONString } from '../utility/JSONUtils.js';
import { executeSafely } from '../utility/errorGuard.js';
import wsutil from '../../client/scripts/esm/util/wsutil.js';

/**
 * Type Definitions
 * @typedef {import('./game/TypeDefinitions.js').Socket} Socket
 * @typedef {import('./game/TypeDefinitions.js').WebsocketMessage} WebsocketMessage
 */

let WebSocketServer;

/**
 * An object containing all active websocket connections, with their ID's for the keys: `{ 21: websocket }`
 */
const websocketConnections = {}; // Object containing all active web socket connections, with their ID's for the KEY
/**
 * An object with IP addresses for the keys, and arrays of their
 * socket id's they have open for the value: `{ "83.28.68.253": [21] }`
 */
const connectedIPs = {}; // Keys are the IP. Values are array lists containing all connection IDs they have going.
/**
 * An object with member names for the keys, and arrays of their
 * socket id's they have open for the value: `{ naviary: [21] }`
 */
const connectedMembers = {};

const printIncomingAndClosingSockets = false;
const printIncomingAndOutgoingMessages = false;

/**
 * The maximum age a websocket connection will live before auto terminating, in milliseconds.
 * Users have to provide authentication whenever they open a new socket.
 */
const maxWebSocketAgeMillis = 1000 * 60 * 15; // 15 minutes. 
// const maxWebSocketAgeMillis = 1000 * 10; // 10 seconds for dev testing

const maxSocketsAllowedPerIP = 10;
const maxSocketsAllowedPerMember = 5;

/**
 * The time, after which we don't hear an expected echo from a websocket,
 * in which it be assumed disconnected, and auto terminated, in milliseconds.
*/
const timeToWaitForEchoMillis = 5000; // 5 seconds until we assume we've disconnected!
/**
 * An object containing the timeout ID's for the timers that auto terminate
 * websockets if we never hear an echo back: `{ messageID: timeoutID }`
 */
const echoTimers = {};

const timeOfInactivityToRenewConnection = 10000;


/**
 * 
 * @param {Socket} ws 
 * @param {Object} req
 */
function onConnectionRequest(ws, req) {
	// Make sure the connection is secure https
	const origin = req.headers.origin;
	if (!origin.startsWith('https')) {
		console.log('WebSocket connection request rejected. Reason: Not Secure. Origin:', origin);
		return ws.close(1009, "Not Secure");
	}

	// Make sure the origin is our website
	if (!DEV_BUILD && origin !== `https://${HOST_NAME}`) { // In DEV_BUILD, allow all origins.
		console.log(`WebSocket connection request rejected. Reason: Origin Error. Origin: ${origin}   Should be: https://${HOST_NAME}`);
		return ws.close(1009, "Origin Error");
	}

	// Parse cookies from the Upgrade http headers
	ws.cookies = getCookiesFromWebsocket(req);

	ws.metadata = {
		subscriptions: {}, // NEEDS TO BE INITIALIZED before we do anything it will crash because it's undefined!
		userAgent: req.headers['user-agent'],
	};

	// Rate Limit Here
	// A false could either mean:
	// 1. IP undefined
	// 2. Too many requests
	// 3. Message too big
	// In ALL these cases, we are terminating all the IPs sockets for now!
	if (!rateLimitWebSocket(req, ws)) { // Connection not allowed
		return terminateAllIPSockets(ws.metadata.IP);
	};

	// Check if ip has too many connections
	if (clientHasMaxSocketCount(ws.metadata.IP)) {
		console.log(`Client IP ${ws.metadata.IP} has too many sockets! Not connecting this one.`);
		return ws.close(1009, 'Too Many Sockets');
	}
	
	// Initialize who they are. Member? Browser ID?...
	verifyJWTWebSocket(req, ws); // Auto sets ws.metadata.memberInfo properties!

	if (ws.metadata.memberInfo.signedIn && memberHasMaxSocketCount(ws.metadata.memberInfo.username)) {
		console.log(`Member ${ws.metadata.memberInfo.username} has too many sockets! Not connecting this one.`);
		return ws.close(1009, 'Too Many Sockets');
	}

	if (!ws.metadata.memberInfo.signedIn && ws.cookies['browser-id'] === undefined) { // Terminate web socket connection request, they NEED authentication!
		console.log(`Authentication needed for WebSocket connection request!! Socket:`);
		wsutility.printSocket(ws);
		return ws.close(1008, 'Authentication needed'); // Code 1008 is Policy Violation
	}

	const id = giveWebsocketUniqueID(ws); // Sets the ws.metadata.id property of the websocket

	websocketConnections[id] = ws; // Add the connection to our list of all websocket connections
	addConnectionToConnectedIPs(ws.metadata.IP, id); // Add the conenction to THIS IP's list of connections (so we can cap on a per-IP basis)
	addConnectionToConnectedMembers(ws.metadata.memberInfo.username, id);

	// Log the request
	logWebsocketStart(req, ws);

	if (printIncomingAndClosingSockets) console.log(`New WebSocket connection established. Socket count: ${Object.keys(websocketConnections).length}. Metadata: ${wsutility.stringifySocketMetadata(ws)}`);

	ws.on('message', (message) => { executeSafely(onmessage, 'Error caught within websocket on-message event:', req, ws, message); });
	ws.on('close', (code, reason) => { executeSafely(onclose, 'Error caught within websocket on-close event:', ws, code, reason); });
	ws.on('error', (error) => { executeSafely(onerror, 'Error caught within websocket on-error event:', ws, error); });

	// We include the sendmessage function on the websocket to avoid circular dependancy with these scripts!
	ws.metadata.sendmessage = sendmessage;

	ws.metadata.clearafter = setTimeout(closeWebSocketConnection, maxWebSocketAgeMillis, ws, 1000, 'Connection expired'); // Code 1000 for normal closure

	// Send the current game vesion, so they will know whether to refresh.
	sendmessage(ws, 'general', 'gameversion', GAME_VERSION);
}

/**
 * Callback function that is executed whenever we receive an incoming websocket message.
 * Sends an echo (unless this message itself **is** an echo), rate limits,
 * logs the message, then routes the message where it needs to go.
 * @param {*} req 
 * @param {Socket} ws 
 * @param {string} rawMessage 
 * @returns 
 */
function onmessage(req, ws, rawMessage) {
	/** @type {WebsocketMessage} */
	let message;
	try {
		// Parse the stringified JSON message.
		// Incoming message is in binary data, which can also be parsed into JSON
		message = JSON.parse(rawMessage);
		// {
		//     route, // general/invites/game
		//     action, // sub/unsub/createinvite/cancelinvite/acceptinvite
		//     value,
		//     id // ID of the message, for listening for the echo
		// }
	} catch (error) {
		if (!rateLimitWebSocket(req, ws)) return; // Don't miss rate limiting
		logReqWebsocketIn(ws, rawMessage); // Log it anyway before quitting
		const errText = `'Error parsing incoming message as JSON: ${JSON.stringify(error)}. Socket: ${wsutility.stringifySocketMetadata(ws)}`;
		console.error(errText);
		logEvents(errText, 'hackLog.txt');
		return sendmessage(ws, 'general', 'printerror', `Invalid JSON format!`);
	}

	// Is the parsed message body an object? If not, accessing properties would give us a crash.
	// We have to separately check for null because JAVASCRIPT has a bug where  typeof null => 'object'
	if (typeof message !== 'object' || message === null) return ws.metadata.sendmessage(ws, "general", "printerror", "Invalid websocket message.");

	const isEcho = message.action === "echo";
	if (isEcho) {
		const validEcho = cancelTimerOfMessageID(message); // Cancel timer to assume they've disconnected
		if (!validEcho) {
			if (!rateLimitWebSocket(req, ws)) return; // Don't miss rate limiting
			logReqWebsocketIn(ws, rawMessage); // Log the request anyway.
			const errText = `User detected sending invalid echo! Message: ${JSON.stringify(message)}. Metadata: ${wsutility.stringifySocketMetadata(ws)}`;
			console.error(errText);
			logEvents(errText, 'errLog.txt');
		}
		return;
	}

	// Not an echo...

	// Rate Limit Here
	if (!rateLimitWebSocket(req, ws)) return; // Will have already returned if too many messages.

	// Log the request.
	logReqWebsocketIn(ws, rawMessage);

	if (printIncomingAndOutgoingMessages && !isEcho) console.log("Received message: " + JSON.stringify(message));

	// Send our echo here! We always send an echo to every message except echos themselves.
	if (ws.metadata.sendmessage) ws.metadata.sendmessage(ws, "general", "echo", message.id);

	// Route them to their specified location
	switch (message.route) {
		case "general":
			handleGeneralMessage(ws, message); // { route, action, value, id }
			break;
		case "invites":
			// Forward them to invites subscription to handle their action!
			handleInviteRoute(ws, message); // { route, action, value, id }
			break;
		case "game":
			// Forward them to our games module to handle their action
			handleGameRoute(ws, message);
			break;
		default: { // Surround this case in a block so it's variables are not hoisted
			const errText = `UNKNOWN web socket received route "${message.route}"! Message: ${rawMessage}. Socket: ${wsutility.stringifySocketMetadata(ws)}`;
			logEvents(errText, 'hackLog.txt', { print: true });
			sendmessage(ws, 'general', 'printerror', `Unknown route "${message.route}"!`);
			return;
		}
	}
}

/**
 * Tell them to hard-refresh the page, there's a new update.
 * @param {Socket} ws - The websocket
 */
function informSocketToHardRefresh(ws) {
	console.log(`Informing socket to hard refresh! ${wsutility.stringifySocketMetadata(ws)}`);
	sendmessage(ws, 'general', 'hardrefresh', GAME_VERSION);
}

function onclose(ws, code, reason) {
	reason = reason.toString();

	// Delete connection from object.
	const id = ws.metadata.id;
	delete websocketConnections[id];
	removeConnectionFromConnectedIPs(ws.metadata.IP, id);
	removeConnectionFromConnectedMembers(ws.metadata.memberInfo.username, id);

	// What if the code is 1000, and reason is "Connection closed by client"?
	// I then immediately want to delete their invite.
	// But what other reasons could it close... ?
	// Code 1006, Message "" is just a network failure.

	// True if client had no power over the closure,
	// DON'T COUNT this as a disconnection!
	// They would want to keep their invite, AND remain in their game!
	const closureNotByChoice = wsutil.wasSocketClosureNotByTheirChoice(code, reason);

	// Unsubscribe them from all. NO LIST. It doesn't matter if they want to keep their invite or remain
	// connected to their game, without a websocket to send updates to, there's no point in any SUBSCRIPTION service!
	// Unsubbing them from their game will start their auto-resignation timer.
	unsubClientFromAllSubs(ws, closureNotByChoice);

	// Cancel the timer to auto delete it at the end of its life
	clearTimeout(ws.metadata.clearafter);
	if (printIncomingAndClosingSockets) console.log(`WebSocket connection has been closed. Code: ${code}. Reason: ${reason}. Socket count: ${Object.keys(websocketConnections).length}`);

	cancelRenewConnectionTimer(ws);

	if (reason === 'No echo heard') console.log(`Socket closed from no echo heard. ${wsutility.stringifySocketMetadata(ws)}`);
}

function onerror(ws, error) {
	const errText = `An error occurred in a websocket. ${wsutility.stringifySocketMetadata(ws)}\n${error.stack}`;
	logEvents(errText, 'errLog.txt', { print: true });
}

/**
 * Sends a message to this websocket's client.
 * @param {Object} ws - The websocket
 * @param {string} sub - What subscription/route this message should be forwarded to.
 * @param {string} action - What type of action the client should take within the subscription route.
 * @param {*} value - The contents of the message.
 * @param {number} [replyto] If applicable, the id of the socket message this message is a reply to.
 * @param {Object} [options] - Additional options for sending the message.
 * @param {boolean} [options.skipLatency=false] - If true, we send the message immediately, without waiting for simulated latency again.
 */
function sendmessage(ws, sub, action, value, replyto, { skipLatency } = {}) { // socket, invites, createinvite, inviteinfo, messageIDReplyingTo
	// If we're applying simulated latency delay, set a timer to send this message.
	if (simulatedWebsocketLatencyMillis !== 0 && !skipLatency) return setTimeout(sendmessage, simulatedWebsocketLatencyMillis, ws, sub, action, value, replyto, { skipLatency: true });

	if (!ws) return console.error(`Cannot send a message to an undefined socket! Sub: ${sub}. Action: ${action}. Value: ${value}`);
	if (ws.readyState === WebSocket.CLOSED) {
		const errText = `Websocket is in a CLOSED state, can't send message. Action: ${action}. Value: ${ensureJSONString(value)}\nSocket: ${wsutility.stringifySocketMetadata(ws)}`;
		logEvents(errText, 'errLog.txt', { print: true });
		return;
	}
    
	const payload = {
		sub, // general/error/invites/game
		action, // sub/unsub/createinvite/cancelinvite/acceptinvite
		value // sublist/inviteslist/move
	};
	// Only include an id (and except an echo back) if this is NOT an echo'ing itself!
	const isEcho = action === "echo";
	if (!isEcho) payload.id = generateNumbID(10);
	if (typeof replyto === 'number') payload.replyto = replyto;

	if (printIncomingAndOutgoingMessages && !isEcho) console.log(`Sending: ${JSON.stringify(payload)}`);

	// Set a timer. At the end, just assume we've disconnected and start again.
	// This will be canceled if we here the echo in time.
	if (!isEcho) echoTimers[payload.id] = setTimeout(closeWebSocketConnection, timeToWaitForEchoMillis, ws, 1014, "No echo heard", payload.id); // Code 1014 is Bad Gateway
	//console.log(`Set timer of message id "${id}"`)

	const stringifiedPayload = JSON.stringify(payload);
	ws.send(stringifiedPayload);
	if (!isEcho) logReqWebsocketOut(ws, stringifiedPayload);

	rescheduleRenewConnection(ws);
}


/**
 * Reschedule the timer to send an empty message to the client
 * to verify they are still connected and responding.
 * @param {Socket} ws - The socket
 */
function rescheduleRenewConnection(ws) {
	cancelRenewConnectionTimer(ws);
	// Only reset the timer if they are subscribed to a game,
	// or they have an open invite!
	if (!ws.metadata.subscriptions.game && !userHasInvite(ws)) return;

	ws.metadata.renewConnectionTimeoutID = setTimeout(renewConnection, timeOfInactivityToRenewConnection, ws);
}

function cancelRenewConnectionTimer(ws) {
	clearTimeout(ws.metadata.renewConnectionTimeoutID);
	ws.metadata.renewConnectionTimeoutID = undefined;
}

/**
 * 
 * @param {Socket} ws - The socket
 */
function renewConnection(ws) {
	sendmessage(ws, 'general', 'renewconnection');
}

// Call when we received the echo from one of our messages.
// This wil cancel the timer that assumes they've disconnected after a few seconds!
function cancelTimerOfMessageID(data) { // { sub, action, value, id }
	const echoMessageID = data.value; // If the action is an "echo", the message ID their echo'ing is stored in "value"!
	const timeoutID = echoTimers[echoMessageID];
	if (timeoutID === undefined) return false; // Timer doesn't exist. Invalid echo messageID!
	clearTimeout(timeoutID);
	delete echoTimers[echoMessageID];
	return true;
}

// Sets the metadata.id property of the websocket connection!
function giveWebsocketUniqueID(ws) {
	const id = genUniqueID(12, websocketConnections);
	ws.metadata.id = id;
	return id;
}

function addConnectionToConnectedIPs(IP, id) {
	if (!connectedIPs[IP]) connectedIPs[IP] = [];
	connectedIPs[IP].push(id);
}

/**
 * Adds the websocket ID to the list of member's connected sockets.
 * @param {string} member - The member's username, lowercase.
 * @param {number} socketID - The ID of their socket.
 */
function addConnectionToConnectedMembers(member, socketID) {
	if (!member) return; // Not logged in
	if (!connectedMembers[member]) connectedMembers[member] = [];
	connectedMembers[member].push(socketID);
}

function removeConnectionFromConnectedIPs(IP, id) {
	const connectionList = connectedIPs[IP];
	if (!connectionList) return;
	if (connectedIPs[IP].length === 0) return console.log("connectedIPs[IP] is DEFINED [], yet EMPTY! If it's empty, it should have been deleted!");
	// Check if the value exists in the array
	const index = connectionList.indexOf(id);
	if (index === -1) return;
	// Remove the item at the found index
	connectionList.splice(index, 1);

	// If it's now empty, just delete the ip entirely
	if (connectionList.length === 0) delete connectedIPs[IP];
}

/**
 * Removes the websocket ID from the list of member's connected sockets.
 * @param {string} member - The member's username, lowercase.
 * @param {number} socketID - The ID of their socket.
 */
function removeConnectionFromConnectedMembers(member, socketID) {
	if (!member) return; // Not logged in
	const membersSocketIDsList = connectedMembers[member];
	const indexOfSocketID = membersSocketIDsList.indexOf(socketID);
	membersSocketIDsList.splice(indexOfSocketID, 1);
	if (membersSocketIDsList.length === 0) delete connectedMembers[member];
}

/**
 * Returns true if the given IP has the maximum number of websockets opened.
 * @param {number} IP - The IP address
 * @returns {boolean} *true* if they have too many sockets.
 */
function clientHasMaxSocketCount(IP) {
	return connectedIPs[IP]?.length >= maxSocketsAllowedPerIP;
}

/**
 * Returns true if the given member has the maximum number of websockets opened.
 * @param {string} member - The member name, in lowercase.
 * @returns {boolean} *true* if they have too many sockets.
 */
function memberHasMaxSocketCount(member) {
	return connectedMembers[member]?.length >= maxSocketsAllowedPerMember;
}

/**
 * 
 * @param {string} IP 
 * @returns 
 */
function terminateAllIPSockets(IP) {
	if (!IP) return;
	const connectionList = connectedIPs[IP];
	if (!connectionList) return; // IP is defined, but they don't have any sockets to terminate!
	for (const id of connectionList) {
		//console.log(`Terminating 1.. id ${id}`)
		const ws = websocketConnections[id];
		ws.close(1009, 'Message Too Big'); // Perhaps this will be a duplicate close action? Because rateLimit.js also can also close the socket.
	}

	// console.log(`Terminated all of IP ${IP}`)
	// console.log(connectedIPs) // This will still be full because they aren't actually spliced out of their list until the close() is complete!
}

function closeWebSocketConnection(ws, code, message, messageID) {
	if (messageID) { // Timer is just now ringing. Delete the timer from the echoTimers list, so it doesn't fill up!
		delete echoTimers[messageID];
	}
	//console.log(`Closing web socket connection.. Code ${code}. Message "${message}"`)
	const readyStateClosed = ws.readyState === WebSocket.CLOSED;
	if (readyStateClosed && message === "Connection expired") return console.log(`Web socket already closed! This function should not have been run. Code ${code}. Message ${message}`);
	else if (readyStateClosed) return;
	ws.close(code, message);
}

function getCookiesFromWebsocket(req) { // req is the WEBSOCKET on-connection request!

	// req.cookies is only defined from our cookie parser for REGULAR requests,
	// NOT for websocket upgrade requests! We have to parse them manually!

	const rawCookies = req.headers.cookie; // In the format: "invite-tag=etg5b3bu; jwt=9732fIESLGIESLF"
	const cookies = {};
	if (!rawCookies || typeof rawCookies !== 'string') return cookies;

	try {
		rawCookies.split(';').forEach(cookie => {
			const parts = cookie.split('=');
			const name = parts[0].trim(); // What to do if parts[0] is undefined?
			const value = parts[1].trim(); // What to do if parts[0] is undefined?
			cookies[name] = value;
		});
	} catch (e) {
		const errText = `Websocket connection request contained cookies in an invalid format!! Cookies: ${ensureJSONString(rawCookies)}\n${e.stack}`;
		logEvents(errText, 'errLog.txt', { print: true });
	}

	return cookies;
}

// Route for this incoming message is "general". What is their action?
function handleGeneralMessage(ws, data) { // data: { route, action, value, id }
	// Listen for new subscriptions or unsubscriptions
	switch (data.action) {
		case "sub":
			handleSubbing(ws, data.value);
			break;
		case "unsub":
			handleUnsubbing(ws, data.value);
			break;
		case 'feature-not-supported':
			handleFeatureNotSupported(ws, data.value);
			break;
		default: { // Surround this case in a block so that it's variables are not hoisted
			const errText = `UNKNOWN web socket received action in general route! ${data.action}. Socket: ${wsutility.stringifySocketMetadata(ws)}`;
			logEvents(errText, 'hackLog.txt', { print: true });
			sendmessage(ws, 'general', 'printerror', `Unknown action "${data.action}" in route general.`);
			return;
		}
	}
}

function handleFeatureNotSupported(ws, description) {
	const errText = `Client unsupported feature: ${ensureJSONString(description)}   Socket: ${wsutility.stringifySocketMetadata(ws)}\nBrowser info: ${ws.metadata.userAgent}`;
	logEvents(errText, 'featuresUnsupported.txt', { print: true });
}

function handleSubbing(ws, value) {
	if (!ws.metadata.subscriptions) ws.metadata.subscriptions = {};

	// What are they wanting to subscribe to for updates?
	switch (value) {
		case "invites":
			// Subscribe them to the invites list
			subToInvitesList(ws);
			break;
		default: { // Surround this case in a block so that it's variables are not hoisted
			const errText = `Cannot subscribe user to strange new subscription list ${value}! Socket: ${wsutility.stringifySocketMetadata(ws)}`;
			logEvents(errText, 'hackLog.txt', { print: true });
			sendmessage(ws, 'general', 'printerror', `Cannot subscribe to "${value}" list!`);
			return;
		}
	}
}

// Set closureNotByChoice to true if you don't immediately want to disconnect them, but say after 5 seconds
function handleUnsubbing(ws, key, subscription, closureNotByChoice) { // subscription: game: { id, color }
	// What are they wanting to unsubscribe from updates from?
	switch (key) {
		case "invites":
			// Unsubscribe them from the invites list
			unsubFromInvitesList(ws, closureNotByChoice);
			break;
		case "game":
			// If the unsub is not by choice (network interruption instead of closing tab), then we give them
			// a 5 second cushion before starting an auto-resignation timer
			unsubClientFromGameBySocket(ws, { unsubNotByChoice: closureNotByChoice });
			break;
		default: { // Surround this case in a block so that it's variables are not hoisted
			const errText = `Cannot unsubscribe user from strange old subscription list ${key}! Socket: ${wsutility.stringifySocketMetadata(ws)}`;
			logEvents(errText, 'hackLog.txt', { print: true });
			return sendmessage(ws, 'general', 'printerror', `Cannot unsubscribe from "${key}" list!`);
		}
	}
}

// Set closureNotByChoice to true if you don't immediately want to disconnect them, but say after 5 seconds
function unsubClientFromAllSubs(ws, closureNotByChoice) {
	if (!ws.metadata.subscriptions) return; // No subscriptions

	const subscriptions = ws.metadata.subscriptions;
	const subscriptionsKeys = Object.keys(subscriptions);
	for (const key of subscriptionsKeys) {
		const thisSubscription = subscriptions[key]; // invites/game
		handleUnsubbing(ws, key, thisSubscription, closureNotByChoice);
	}
}


function start(httpsServer) {
	WebSocketServer = new Server({ server: httpsServer }); // Create a WebSocket server instance
	// WebSocketServer.on('connection', onConnectionRequest); // Event handler for new WebSocket connections
	WebSocketServer.on('connection', (ws, req) => {
		executeSafely(onConnectionRequest, 'Error caught within websocket on-connection request:', ws, req);
	}); // Event handler for new WebSocket connections
}

/**
 * Closes all sockets a given member has open.
 * @param {string} member - The member's username, in lowercase.
 * @param {number} closureCode - The code of the socket closure, sent to the client.
 * @param {string} closureReason - The closure reason, sent to the client.
 */
function closeAllSocketsOfMember(member, closureCode, closureReason) {
	connectedMembers[member]?.slice().forEach(socketID => { // slice() makes a copy of it
		const ws = websocketConnections[socketID];
		closeWebSocketConnection(ws, closureCode, closureReason);
	});
}

export default {
	start,
	closeAllSocketsOfMember
};
