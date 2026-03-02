/**
 * EnsRegistrationRepository
 *
 * Encapsulates storage for ENS registration intents.
 * Backed by a JSON file for now.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ENS_FILE = join(process.cwd(), 'ens-registrations.json');

function loadEnsRegistrations() {
  if (!existsSync(ENS_FILE)) {
    return [];
  }
  return JSON.parse(readFileSync(ENS_FILE, 'utf-8'));
}

function saveEnsRegistrations(regs) {
  writeFileSync(ENS_FILE, JSON.stringify(regs, null, 2));
}

let registrations = loadEnsRegistrations();

export function getEnsRegistrations() {
  return registrations;
}

export function persistEnsRegistrations() {
  saveEnsRegistrations(registrations);
}

export function addEnsRegistration(registration) {
  registrations.push(registration);
  persistEnsRegistrations();
  return registration;
}

