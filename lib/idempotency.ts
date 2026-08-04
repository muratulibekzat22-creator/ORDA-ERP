import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
export type IdempotencyKeyResult={key:string}|{response:NextResponse};
export function readIdempotencyKey(request:Request):IdempotencyKeyResult{const key=request.headers.get("Idempotency-Key")?.trim();return key?{key}:{response:NextResponse.json({error:"Idempotency-Key обязателен"},{status:400})};}
export function createRequestHash(payload:unknown){return createHash("sha256").update(JSON.stringify(payload)).digest("hex");}
export function compareRequestHash(existing:string|null,incoming:string){return existing===incoming;}
export function isPrismaUniqueConflict(error:unknown){return error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002";}
export function idempotencyConflict(){return NextResponse.json({error:"Idempotency-Key уже использован с другим payload"},{status:409});}
