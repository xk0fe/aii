// The tests cover the phone's network layer (src/net), which is plain TypeScript: no React Native environment needed.
// shared/ (the contract) sits next to mobile/ and is transformed like our own code; @noble ships ES modules only.
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // what babel adds to shared/'s files (its runtime helpers) resolves from here
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: ['node_modules/(?!(@noble|(jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?/.*|expo-.*))'],
}
