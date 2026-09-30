/** Browser-safe base64 decode (no Node Buffer on the client). */
export function base64ToBytes(value: string) {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
