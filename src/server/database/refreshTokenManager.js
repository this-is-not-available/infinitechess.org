
import { getMemberDataByCriteria, updateMemberColumns } from './memberManager.js';
import { logEvents } from '../middleware/logEvents.js';
import { addTokenToRefreshTokens, deleteRefreshTokenFromTokenList, removeExpiredTokens } from '../controllers/authenticationTokens/refreshTokenObject.js';


/**
 * This script fetches users' refresh tokens from the database and saves them to there.
 * 
 * We do NOT generate the tokens here.
 */


/**
 * Fetches the refresh tokens for a given user ID.
 * @param {number} userId - The user ID of the member whose refresh tokens are to be fetched.
 * @returns {object[]|undefined} - An array of all their refresh tokens: [ { token, issued, expires }, { token, issued, expires }, ...], or undefined if the member doesn't exist
 */
function getRefreshTokensByUserID(userId) {
	let { refresh_tokens } = getMemberDataByCriteria(['refresh_tokens'], 'user_id', userId);

	// If the user doesn't exist (row is undefined), return undefined.
	if (refresh_tokens === undefined) {
		logEvents(`Cannot get refresh tokens of a non-existent member of id "${userId}"!`, 'errLog.txt', { print: true });
		return;
	}

	// If the user exists but has null or no refresh tokens, return an empty array.
	if (refresh_tokens === null) refresh_tokens = '[]';

	return JSON.parse(refresh_tokens);
}

/**
 * Adds a new refresh token in the database to the refresh_tokens column for a member.
 * @param {object} req
 * @param {number} userId - The user ID of the member.
 * @param {string} token - The new refresh token to add.
 */
function addRefreshTokenToMemberData(req, userId, token) {
	// Get the current refresh tokens
	let refreshTokens = getRefreshTokensByUserID(userId);
	if (refreshTokens === undefined) return logEvents(`Cannot add refresh token to non-existent member with id "${userId}"!`, 'errLog.txt', { print: true });

	// Remove any expired tokens
	refreshTokens = removeExpiredTokens(refreshTokens);

	// Add the new token to the list
	refreshTokens = addTokenToRefreshTokens(req, refreshTokens, token);

	// Save the tokens in the database
	saveRefreshTokens(userId, refreshTokens);
}


/**
 * Deletes a specific refresh token in the database for a user based on their user_id.
 * @param {number} userId - The user ID of the member whose refresh token is to be deleted.
 * @param {string} token - The refresh token to be deleted from the user's refresh_tokens column.
 */
function deleteRefreshTokenFromMemberData(userId, deleteToken) {
	// Fetch the current refresh tokens for the user
	const refreshTokens = getRefreshTokensByUserID(userId);
	if (refreshTokens === undefined) return logEvents(`Cannot delete refresh token from non-existent member with id "${userId}"!`, 'errLog.txt', { print: true });

	// Remove any expired tokens. Do this whenever we read and write it.
	let newRefreshTokens = removeExpiredTokens(refreshTokens);

	// Remove the specified refresh token from the array
	newRefreshTokens = deleteRefreshTokenFromTokenList(newRefreshTokens, deleteToken);

	// Save the updated refresh tokens
	if (newRefreshTokens.length !== refreshTokens.length) saveRefreshTokens(userId, newRefreshTokens);
	else logEvents(`Unable to find refresh token to delete of member with id "${userId}"!`, 'errLog.txt', { print: true });
}

/**
 * Updates the refresh tokens for a given user.
 * @param {number} userId - The user ID of the member.
 * @param {object[]} tokens - The new array of refresh tokens to save.
 * @param {boolean} isRefreshToken - Indicates whether the token is a refresh token (false if access token).
 */
function saveRefreshTokens(userId, tokens) {
	// If the tokens array is empty, set it to null
	if (tokens.length === 0) tokens = null;

	// Update the refresh_tokens or access_tokens column
	const updateResult = updateMemberColumns(userId, { refresh_tokens: tokens });

	// If no changes were made, log the event
	if (!updateResult) logEvents(`No changes made when saving refresh_tokens of member with id "${userId}"!`, 'errLog.txt', { print: true });
}



export {
	addRefreshTokenToMemberData,
	deleteRefreshTokenFromMemberData,
	getRefreshTokensByUserID,
	saveRefreshTokens,
};