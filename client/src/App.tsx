import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CommandPaletteRoot } from "./components/CommandPalette";
import { UpdateHost } from "./components/UpdateHost";
import { DashboardPage } from "./pages/DashboardPage";
import { EditorPage } from "./pages/EditorPage";
import { GeneratePage } from "./pages/GeneratePage";
import { NewDiagramPage } from "./pages/NewDiagramPage";
import { PresentPage } from "./pages/PresentPage";
import { ReferencePage } from "./pages/ReferencePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TemplatePresentPage } from "./pages/TemplatePresentPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export default function App() {
  return (
    <BrowserRouter>
      <CommandPaletteRoot>
        <UpdateHost>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/new" element={<NewDiagramPage />} />
          <Route path="/generate" element={<GeneratePage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/present/:id" element={<TemplatePresentPage />} />
        <Route path="/edit/*" element={<EditorPage />} />
        <Route path="/present/*" element={<PresentPage />} />
        <Route path="/reference" element={<ReferencePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </UpdateHost>
      </CommandPaletteRoot>
    </BrowserRouter>
  );
}
