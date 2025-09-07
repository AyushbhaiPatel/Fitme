const crypto = require('crypto');
const bcrypt = require('bcryptjs');

class OTPGenerator {
  static generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  static async hashOTP(otp) {
    return bcrypt.hash(otp, 12);
  }

  static async verifyOTP(plainOTP, hashedOTP) {
    return bcrypt.compare(plainOTP, hashedOTP);
  }

  static getOTPExpiry() {
    return new Date(Date.now() + 5 * 60 * 1000);
  }

  static isOTPExpired(expiryDate) {
    return new Date() > expiryDate;
  }

  static validateOTPFormat(otp) {
    return typeof otp === 'string' && /^[0-9]{6}$/.test(otp);
  }
}

module.exports = OTPGenerator;
