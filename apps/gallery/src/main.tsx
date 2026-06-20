import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { GalleryPage } from './pages/GalleryPage.js';
import './index.css';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  { path: '/g/:shareToken', element: <GalleryPage /> },
  { path: '*', element: <Navigate to="/g/demo" replace /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
