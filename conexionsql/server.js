const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const dbConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'sql123',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'AuxiliarCalificacionesDB',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let poolPromise;
function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig);
  }
  return poolPromise;
}


app.get('/api/app-info', (_req, res) => {
  res.json({
    ok: true,
    app: 'AuxiliarCalificaciones SQL API',
    version: '2.0.0',
    routes: ['/api/health', '/api/bootstrap', '/api/calificaciones/bulk'],
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    res.json({ ok: true, message: 'Conexión SQL Server correcta' });
  } catch (err) {
    console.error('Error de conexión SQL:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/bootstrap', async (_req, res) => {
  try {
    const pool = await getPool();
    const [usuarios, raCarrera, asignaturas, mapa, estudiantes, calificaciones, parametros] = await Promise.all([
      pool.request().query('SELECT UsuarioID, CodigoDocente, NombreCompleto, Email, Contrasena, Rol, TituloAcademico FROM Usuarios'),
      pool.request().query('SELECT RACarreraID, CodigoRA, Descripcion, NivelEstrategico, AreaDeConocimiento FROM RACarrera'),
      pool.request().query('SELECT AsignaturaID, CodigoAsignatura, NombreAsignatura, Creditos, DocenteID FROM Asignaturas'),
      pool.request().query(`
        SELECT m.MapaID, m.RACarreraID, m.AsignaturaID, m.NivelAportacion, a.CodigoAsignatura
        FROM MapaCurricular m
        INNER JOIN Asignaturas a ON a.AsignaturaID = m.AsignaturaID
      `),
      pool.request().query('SELECT EstudianteID, Cedula, NombreCompleto FROM Estudiantes'),
      pool.request().query('SELECT EstudianteID, AsignaturaID, PeriodoAcademico, ACD, APEX, AAUT FROM Calificaciones'),
      pool.request().query('SELECT TOP 1 NotaMinimaAprobatoria, PesoACD, PesoAPEX, PesoAAUT, PeriodoActual FROM Parametros ORDER BY ParametroID DESC'),
    ]);

    const docentesPorId = new Map(usuarios.recordset.map((u) => [u.UsuarioID, u.NombreCompleto]));

    const response = {
      usuarios: usuarios.recordset,
      raCarrera: raCarrera.recordset,
      asignaturas: asignaturas.recordset.map((a) => ({
        ...a,
        DocenteNombre: a.DocenteID ? docentesPorId.get(a.DocenteID) || 'Sin Asignar' : 'Sin Asignar',
      })),
      mapaCurricular: mapa.recordset,
      estudiantes: estudiantes.recordset,
      calificaciones: calificaciones.recordset,
      parametros: parametros.recordset[0] || null,
    };

    res.json(response);
  } catch (err) {
    console.error('Error en /api/bootstrap:', err);
    res.status(500).json({ error: 'No se pudo cargar bootstrap', detalle: err.message });
  }
});

app.post('/api/calificaciones/bulk', async (req, res) => {
  const { asignaturaCode, periodoAcademico, notas } = req.body;

  if (!asignaturaCode || !periodoAcademico || !Array.isArray(notas)) {
    return res.status(400).json({ error: 'Parámetros inválidos' });
  }

  try {
    const pool = await getPool();

    const asigResult = await pool
      .request()
      .input('codigo', sql.NVarChar(20), asignaturaCode)
      .query('SELECT AsignaturaID FROM Asignaturas WHERE CodigoAsignatura = @codigo');

    if (asigResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Asignatura no encontrada' });
    }

    const asignaturaID = asigResult.recordset[0].AsignaturaID;

    for (const nota of notas) {
      const { cedula, acd, apex, aaut } = nota;
      if (!cedula) continue;

      const estResult = await pool
        .request()
        .input('cedula', sql.NVarChar(15), cedula)
        .query('SELECT EstudianteID FROM Estudiantes WHERE Cedula = @cedula');

      if (estResult.recordset.length === 0) continue;

      const estudianteID = estResult.recordset[0].EstudianteID;

      await pool
        .request()
        .input('EstudianteID', sql.Int, estudianteID)
        .input('AsignaturaID', sql.Int, asignaturaID)
        .input('PeriodoAcademico', sql.NVarChar(100), periodoAcademico)
        .input('ACD', sql.Decimal(5, 2), Number(acd) || 0)
        .input('APEX', sql.Decimal(5, 2), Number(apex) || 0)
        .input('AAUT', sql.Decimal(5, 2), Number(aaut) || 0)
        .query(`
          MERGE Calificaciones AS target
          USING (SELECT @EstudianteID AS EstudianteID, @AsignaturaID AS AsignaturaID, @PeriodoAcademico AS PeriodoAcademico) AS source
          ON target.EstudianteID = source.EstudianteID
            AND target.AsignaturaID = source.AsignaturaID
            AND target.PeriodoAcademico = source.PeriodoAcademico
          WHEN MATCHED THEN
            UPDATE SET ACD = @ACD, APEX = @APEX, AAUT = @AAUT, FechaActualizacion = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (EstudianteID, AsignaturaID, PeriodoAcademico, ACD, APEX, AAUT)
            VALUES (@EstudianteID, @AsignaturaID, @PeriodoAcademico, @ACD, @APEX, @AAUT);
        `);
    }

    res.json({ ok: true, message: 'Calificaciones guardadas' });
  } catch (err) {
    console.error('Error en /api/calificaciones/bulk:', err);
    res.status(500).json({ error: 'Error guardando calificaciones', detalle: err.message });
  }
});

app.get('/api/:table', (_req, res) => {
  res.status(410).json({
    error: 'Endpoint legacy removido',
    detalle: 'Usa /api/bootstrap o los endpoints nuevos. Reinicia el backend con el archivo server.js actualizado.',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API SQL corriendo en http://localhost:${PORT}`);
  console.log('Rutas: GET /api/app-info, GET /api/health, GET /api/bootstrap, POST /api/calificaciones/bulk');
});
