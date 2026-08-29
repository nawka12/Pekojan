import { useGame } from "./store/game";
import { GameScreen } from "./screens/Game";
import { MainMenu } from "./screens/MainMenu";

export function App() {
  const state = useGame((s) => s.state);
  return (
    <div className="h-full min-h-screen">
      {state ? <GameScreen /> : <MainMenu />}
    </div>
  );
}
