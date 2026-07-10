'use client';

import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server/routers/_app';

/** Typed tRPC React hooks bound to the CopyForge {@link AppRouter}. */
export const trpc = createTRPCReact<AppRouter>();
