const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'users.db');

if (!fs.existsSync(dbPath)) {
    console.log("Database file does not exist. Nothing to clear.");
    process.exit(0);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
        process.exit(1);
    }
});

console.log("Clearing database...");

db.serialize(() => {
    // 1. Clear Users
    db.run("DELETE FROM users", function(err) {
        if (err) {
            console.error("Error clearing users:", err.message);
        } else {
            console.log(`✓ Users table cleared. (${this.changes} rows deleted)`);
        }
    });

    // 2. Clear Verifications (Verification Codes)
    db.run("DELETE FROM verifications", function(err) {
        if (err) {
            // Table might not exist yet if no verification code was ever sent, ignore error
            // console.error("Error clearing verifications:", err.message);
        } else {
            console.log(`✓ Verifications table cleared. (${this.changes} rows deleted)`);
        }
    });
    
    // Optional: Reset Auto Increment ID back to 1
    db.run("DELETE FROM sqlite_sequence WHERE name='users'", function(err) {
         if (!err) console.log("✓ ID counter reset.");
    });
});

db.close((err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Database connection closed.');
});
