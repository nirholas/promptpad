import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { LaunchError } from './launches';
import { firstIssue } from './validate';

export function json(body: unknown, init?: ResponseInit) {
	return NextResponse.json(body, init);
}

/** Maps any thrown error to a structured JSON response; unknown errors are logged, never leaked. */
export function errorResponse(error: unknown) {
	if (error instanceof ZodError) return json({ error: firstIssue(error) }, { status: 400 });
	if (error instanceof LaunchError) return json({ error: error.message }, { status: error.status });
	console.error(error);
	return json({ error: 'Something went wrong on our side. Try again in a moment.' }, { status: 500 });
}

export function clientIp(req: Request) {
	return (
		req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
		req.headers.get('x-real-ip') ||
		'unknown'
	);
}
