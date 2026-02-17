import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Sanitizes string inputs by stripping HTML tags and escaping dangerous characters.
 * Prevents XSS when message content is rendered by clients.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
    transform(value: any): any {
        if (typeof value === 'string') {
            return this.sanitize(value);
        }

        if (typeof value === 'object' && value !== null) {
            return this.sanitizeObject(value);
        }

        return value;
    }

    private sanitize(input: string): string {
        return input
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    private sanitizeObject(obj: Record<string, any>): Record<string, any> {
        const sanitized: Record<string, any> = {};

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = this.sanitize(value);
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }
}
