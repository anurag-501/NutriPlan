import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navbar from "@/components/Navbar";
import NutriPlanChat from "@/components/chat/NutriPlanChat";

const Index = lazy(() => import("./pages/Index"));
const DietRecommendation = lazy(() => import("./pages/DietRecommendation"));
const CustomFoodRecommendation = lazy(() => import("./pages/CustomFoodRecommendation"));
const GymPlanner = lazy(() => import("./pages/GymPlanner"));
const RecipeExplorer = lazy(() => import("./pages/RecipeExplorer"));
const MyPlan = lazy(() => import("./pages/MyPlan"));
const FixMyPlate = lazy(() => import("./pages/FixMyPlate"));
const KitchenFinder = lazy(() => import("./pages/KitchenFinder"));
const FoodSwap = lazy(() => import("./pages/FoodSwap"));
const CampusOptimizer = lazy(() => import("./pages/CampusOptimizer"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Navbar />
        <Suspense fallback={<p className="container py-10 text-sm text-muted-foreground" role="status">Loading NutriPlan…</p>}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/diet" element={<DietRecommendation />} />
            <Route path="/custom" element={<CustomFoodRecommendation />} />
            <Route path="/gym" element={<GymPlanner />} />
            <Route path="/recipes" element={<RecipeExplorer />} />
            <Route path="/fix-my-plate" element={<FixMyPlate />} />
            <Route path="/kitchen" element={<KitchenFinder />} />
            <Route path="/foodswap" element={<FoodSwap />} />
            <Route path="/campus" element={<CampusOptimizer />} />
            <Route path="/my-plan" element={<MyPlan />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <NutriPlanChat />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
