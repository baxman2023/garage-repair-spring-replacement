import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { WorkoutPage } from './components/workout/WorkoutPage';
import { UploadPage } from './components/upload/UploadPage';
import { HistoryPage } from './components/history/HistoryPage';
import { AccoladesPage } from './components/accolades/AccoladesPage';
import { BadgeToast } from './components/accolades/BadgeToast';
import { useWorkoutStore } from './hooks/useWorkoutStore';
import { useAccoladeEvaluator } from './hooks/useAccolades';
import type { WorkoutSession } from './types/exercise';

function App() {
  const store = useWorkoutStore();
  const { evaluate, currentToast, toastDef, dismissToast } = useAccoladeEvaluator();

  const handleSessionSaved = (session: WorkoutSession) => {
    evaluate(
      session,
      store.sessions,
      store.exercises,
      store.earnedAccolades,
      store.addAccolade,
    );
  };

  return (
    <BrowserRouter>
      {toastDef && currentToast && (
        <BadgeToast accolade={toastDef} onDismiss={dismissToast} />
      )}
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/workout" element={
            <WorkoutPage
              exercises={store.exercises}
              addExercise={store.addExercise}
              addSession={store.addSession}
              onSessionSaved={handleSessionSaved}
            />
          } />
          <Route path="/upload" element={
            <UploadPage
              addExercise={store.addExercise}
              earnedAccolades={store.earnedAccolades}
              addAccolade={store.addAccolade}
            />
          } />
          <Route path="/history" element={
            <HistoryPage
              sessions={store.sessions}
              exercises={store.exercises}
              deleteSession={store.deleteSession}
            />
          } />
          <Route path="/accolades" element={
            <AccoladesPage earnedAccolades={store.earnedAccolades} />
          } />
          <Route path="*" element={<Navigate to="/workout" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
