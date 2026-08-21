import { describe, it, expect } from '@jest/globals';
import { safeParseJSON } from '../../src/core/services/jsonParser.js';

describe('JSON Parser Service - safeParseJSON', () => {
    it('should parse valid JSON correctly', () => {
        // Arrange
        const validJSON = '{"name":"John", "age":30, "city":"New York"}';

        // Act
        const result = safeParseJSON(validJSON);

        // Assert
        expect(result).toEqual({ name: 'John', age: 30, city: 'New York' });
    });

    it('should parse valid JSON surrounded by markdown backticks', () => {
        // Arrange
        const markdownJSON = '```json\n{"name":"John", "age":30, "city":"New York"}\n```';

        // Act
        const result = safeParseJSON(markdownJSON);

        // Assert
        expect(result).toEqual({ name: 'John', age: 30, city: 'New York' });
    });

    it('should parse valid JSON surrounded by markdown backticks without "json" identifier', () => {
        // Arrange
        const markdownJSON = '```\n{"name":"John", "age":30, "city":"New York"}\n```';

        // Act
        const result = safeParseJSON(markdownJSON);

        // Assert
        expect(result).toEqual({ name: 'John', age: 30, city: 'New York' });
    });

    it('should throw an error for malformed JSON', () => {
        // Arrange
        const malformedJSON = '{ invalid json syntax without quotes or values }';

        // Act & Assert
        expect(() => safeParseJSON(malformedJSON)).toThrow('Invalid AI response format');
    });

    it('should throw an error for empty string', () => {
        // Arrange
        const emptyString = '';

        // Act & Assert
        expect(() => safeParseJSON(emptyString)).toThrow('Invalid AI response format');
    });

    it('should throw an error for null/undefined input', () => {
        // Arrange
        const nullInput = null;
        const undefinedInput = undefined;

        // Act & Assert
        expect(() => safeParseJSON(nullInput)).toThrow();
        expect(() => safeParseJSON(undefinedInput)).toThrow();
    });
});
