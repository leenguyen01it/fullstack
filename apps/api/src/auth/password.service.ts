import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Hashes and verifies passwords with argon2id.
 * @since REQ-002
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  /**
   * Precomputes a hash used to keep login timing constant when the email is unknown.
   * @since REQ-002
   */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password-for-timing');
  }

  /**
   * Returns the argon2id hash of a plain-text password.
   * @since REQ-002
   */
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /**
   * Returns true when the password matches the hash; verifies against a dummy hash when no hash is given.
   * @since REQ-002
   */
  async verify(hash: string | undefined, password: string): Promise<boolean> {
    try {
      const matches = await argon2.verify(hash ?? this.dummyHash, password);
      return hash !== undefined && matches;
    } catch {
      return false;
    }
  }
}
