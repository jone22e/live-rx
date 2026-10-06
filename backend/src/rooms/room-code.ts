import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET } from '../../../shared/protocol.js';

/** Código aleatório no alfabeto sem caracteres ambíguos (ex.: 7K4P92). */
export function generateRoomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }
  return code;
}
