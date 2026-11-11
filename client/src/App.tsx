import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

/** Hash locations may carry ?ticket= / ?error=; match routes against the path only. */
function useHashPath(): ReturnType<typeof useHashLocation> {
  const [loc, nav] = useHashLocation();
  return [loc.split("?")[0], nav];
}
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { pageTitle } from "@/lib/page-title";
import NotFound from "@/pages/not-found";
import Entry from "@/pages/entry";
const AdminSignin = lazy(() => import("@/pages/admin-signin"));
const AdminConsole = lazy(() => import("@/pages/admin-console"));
const FacilitatorPortal = lazy(() => import("@/pages/facilitator-portal"));
const FacilitatorRooms = lazy(() => import("@/pages/facilitator-rooms"));
const FacilitatorRoom = lazy(() => import("@/pages/facilitator-room"));
const Join = lazy(() => import("@/pages/join"));
const ParticipantRoom = lazy(() => import("@/pages/participant-room"));
const Verify = lazy(() => import("@/pages/verify"));
const Organisations = lazy(() => import("@/pages/organisations"));
const AuthComplete = lazy(() => import("@/pages/auth-complete"));

function RouteTitle() {
  const [loc] = useHashPath();
  const { t } = useI18n();
  const title = pageTitle(loc, t);
  useEffect(() => { document.title = title; }, [title]);
  return null;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Entry} />
      <Route path="/admin" component={AdminSignin} />
      <Route path="/admin/console" component={AdminConsole} />
      <Route path="/facilitate" component={FacilitatorPortal} />
      <Route path="/facilitate/rooms" component={FacilitatorRooms} />
      <Route path="/facilitate/room/:id" component={FacilitatorRoom} />
      <Route path="/join" component={Join} />
      <Route path="/join/:mode" component={Join} />
      <Route path="/p" component={ParticipantRoom} />
      <Route path="/verify" component={Verify} />
      <Route path="/verify/:code" component={Verify} />
      <Route path="/organisations" component={Organisations} />
      <Route path="/auth/complete" component={AuthComplete} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <I18nProvider>
          <Toaster />
          <Router hook={useHashPath}>
            <RouteTitle />
            <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
              <AppRouter />
            </Suspense>
          </Router>
        </I18nProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
