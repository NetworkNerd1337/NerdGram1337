import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { EditorPage } from "./pages/EditorPage";
import { NewDiagramPage } from "./pages/NewDiagramPage";
import { ReferencePage } from "./pages/ReferencePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/new" element={<NewDiagramPage />} />
        <Route path="/edit/*" element={<EditorPage />} />
        <Route path="/reference" element={<ReferencePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
