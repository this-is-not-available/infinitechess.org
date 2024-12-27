
/*
 * This module provides utility functions for managing SQLite database operations 
 * using the `better-sqlite3` library.
 * 
 * It supports executing SQL queries, retrieving  results (single or multiple rows),
 * caching prepared statements for performance,  and handling database transactions.
 */


import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

// Get the current file path and derive the directory (ESM doesn't support __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create or connect to the SQLite database file
const dbPath = path.join(__dirname, '../../../database.db');
const db = new Database(dbPath); // Optional for logging queries
// const db = new Database(dbPath, { verbose: console.log }); // Optional for logging queries


// Variables ----------------------------------------------------------------------------------------------


// Prepared statements cache
const stmtCache = {};


// Query Calls --------------------------------------------------------------------------------------------


// Utility function to retrieve or prepare statements
function prepareStatement(query) {
	if (!stmtCache[query]) {
		// console.log(`Added statement to stmtCache: "${query}"`);
		stmtCache[query] = db.prepare(query);
	}
	return stmtCache[query];
}

/**
 * Executes a given SQL query with optional parameters and returns the result.
 * @param {string} query - The SQL query to be executed.
 * @param {Array} [params=[]] - An array of parameters to bind to the query.
 * @returns {object} - The result of the query execution.
 */
function run(query, params = []) {
	const stmt = prepareStatement(query);
	return stmt.run(...params);
}

/**
 * Retrieves a single row from the database for a given SQL query.
 * @param {string} query - The SQL query to be executed.
 * @param {Array} [params=[]] - An array of parameters to bind to the query.
 * @returns {object|null} - The row object if found, otherwise null.
 */
function get(query, params = []) {
	const stmt = prepareStatement(query);
	return stmt.get(...params);
}

/**
 * Retrieves all rows from the database for a given SQL query.
 * @param {string} query - The SQL query to be executed.
 * @param {Array} [params=[]] - An array of parameters to bind to the query.
 * @returns {Array} - An array of row objects.
 */
function all(query, params = []) {
	const stmt = prepareStatement(query);
	return stmt.all(...params);
}

/**
 * Executes multiple queries in a single transaction for better performance.
 * @param {Array} queries - An array of query objects containing SQL and parameters.
 * @returns {Array} - An array of results for each query in the transaction.
 */
function transaction(queries) {
	const transaction = db.transaction((queries) => {
		return queries.map(({ query, params }) => {
			const stmt = prepareStatement(query);
			return stmt.run(...params);
		});
	});
	return transaction(queries);
}

/** Closes the database connection. */
function close() {
	db.close();
	console.log('Closed database.');
}



export default {
	run,
	get,
	all,
	transaction,
	close,
};
