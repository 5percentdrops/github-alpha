#!/usr/bin/env node
/**
 * Seeds the SQLite database with developers from the JSON dataset.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, upsertDeveloper, closeDb, getDeveloperCount } from '../src/db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'developers-1k-followers.json');

const developers = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

console.log(`Seeding ${developers.length} developers into SQLite...`);

const db = getDb();
const tx = db.transaction(() => {
  for (const dev of developers) {
    upsertDeveloper({
      login: dev.login,
      name: dev.name || null,
      bio: dev.bio || null,
      followers: dev.followers || 0,
      company: dev.company || null,
      location: dev.location || null,
      twitter: dev.twitter || null,
      blog: dev.blog || null,
      url: dev.url || null,
      created: dev.created || null,
    });
  }
});

tx();

const count = getDeveloperCount();
console.log(`✅ Seeded ${count} developers`);
closeDb();
