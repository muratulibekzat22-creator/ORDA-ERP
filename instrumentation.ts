import type { Instrumentation } from "next";
import { productionLog, requestIdFrom } from "@/lib/observability";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  productionLog("error", "http.unhandled_error", {
    requestId: requestIdFrom(request.headers),
    route: context.routePath,
    method: request.method,
    error,
  });
};
