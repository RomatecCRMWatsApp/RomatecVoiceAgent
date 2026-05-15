-- v3.7.0 — Popula geometria_geojson das ruas do Colina Park
-- Pré-requisito: coluna geometria_geojson deve existir em loteamento_ruas

-- Caso não exista, rode este ALTER primeiro (idempotente; ignora erro 'Duplicate'):
-- ALTER TABLE loteamento_ruas ADD COLUMN geometria_geojson TEXT NULL;

SET @lt = (SELECT id FROM loteamentos WHERE nome='Residencial Colina Park');

UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[355.546,348.312],[535.144,383.593]],[[575.375,391.496],[791.752,434.001]]]}' WHERE loteamento_id=@lt AND nome='AVENIDA 01';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[551.308,407.66],[392.712,1215.005]]]}' WHERE loteamento_id=@lt AND nome='AVENIDA 02';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[190.784,909.179],[443.054,958.735]],[[279.044,662.013],[112.982,1157.284]],[[805.218,1029.879],[564.725,982.636]]]}' WHERE loteamento_id=@lt AND nome='AVENIDA 03';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[527.571,225.047],[474.655,214.234]]]}' WHERE loteamento_id=@lt AND nome='RUA AL. 01';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1261.62,407.672],[1255.871,305.068]],[[1224.93,347.63],[1258.151,345.769]],[[1199.369,337.476],[1224.93,347.63]]]}' WHERE loteamento_id=@lt AND nome='RUA AL. 01-A';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[852.117,359.437],[718.299,310.624]],[[718.299,310.624],[646.268,280.255]],[[646.268,280.255],[527.571,225.047]],[[844.095,359.947],[787.466,364.878]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 01';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[623.613,332.691],[787.466,364.878]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 02';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[811.279,784.187],[865.946,785.181],[919.516,785.572],[968.072,786.115],[1015.484,786.673],[1063.897,787.237],[1110.526,787.84],[1158.615,788.326],[1204.978,788.913],[1251.541,789.436],[1291.971,790.015],[1329.923,790.097],[1309.492,425.521]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 03';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[970.874,423.964],[991.547,792.892]],[[903.953,427.714],[924.007,785.588]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 04';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[812.061,798.137],[791.655,433.982]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 06';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[355.143,417.023],[795.552,503.538]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 07';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[521.079,909.13],[607.992,466.693]],[[455.336,896.215],[577.006,920.116]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 08';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[333.555,1168.563],[476.505,440.864]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 09';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[779.617,760.281],[273.127,660.785]],[[420.574,429.876],[321.38,934.833]],[[266.451,923.934],[366.606,419.276]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 10';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[656.793,1232.061],[123.065,1127.214]]]}' WHERE loteamento_id=@lt AND nome='RUA ALIMENTADORA 12';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1287.877,406.2],[791.653,434.007]],[[1100.671,416.685],[1105.613,504.893]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 02';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1239.404,497.395],[975.816,512.166]],[[1242.9,559.797],[979.314,574.569]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 04';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1234.461,409.194],[1255.772,789.497]],[[867.924,785.196],[843.898,356.439]],[[1320.226,617.06],[801.92,646.104]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 05';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1249.838,683.603],[986.25,698.375]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 06';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1253.307,745.506],[989.719,760.277]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 07';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[610.634,398.771],[634.949,274.991]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 08';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[559.211,367.429],[582.289,249.946]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 09';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[499.777,376.868],[529.431,225.912]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 10';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[444.827,366.074],[474.655,214.234]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 11';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[597.197,521.643],[798.884,561.262]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 12';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[779.617,760.281],[811.279,784.187]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 13';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[763.064,554.026],[674.626,1004.225]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 14';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[708.114,543.232],[619.677,993.431]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 15';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[653.124,532.629],[514.163,1240.023]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 16';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[174.358,974.233],[364.396,1011.564]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 19';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[353.601,1066.514],[156.406,1027.776]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 20';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[343.578,1117.538],[139.735,1077.495]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 21';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[465.042,1194.393],[495.883,1037.393]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 22';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[653.614,1174.366],[531.763,1150.429]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 23';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[430.139,1024.479],[802.821,1097.689]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 25';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[809.172,897.971],[589.821,854.882]]]}' WHERE loteamento_id=@lt AND nome='RUA LOCAL 26';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[805.818,1013.907],[812.464,784.209]],[[805.798,1014.013],[802.19,1112.811]],[[803.21,640.183],[729.576,1015.02]],[[823.308,1200.057],[738.159,1183.331]],[[656.513,1231.723],[670.747,1248.927]],[[798.316,1096.804],[823.308,1200.057]]]}' WHERE loteamento_id=@lt AND nome='RUA PERIMETRAL 01';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[1028.799,348.263],[1032.847,420.491]],[[1199.369,337.476],[844.095,359.947]]]}' WHERE loteamento_id=@lt AND nome='RUALOCAL01';
UPDATE loteamento_ruas SET geometria_geojson='{"type":"MultiLineString","coordinates":[[[811.783,1152.443],[541.786,1099.404]],[[714.977,1133.426],[710.511,1156.163]]]}' WHERE loteamento_id=@lt AND nome='VIELA01';
