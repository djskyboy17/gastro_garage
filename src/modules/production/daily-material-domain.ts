/** Concurrency snapshot shared by preview, final transaction and domain tests. */
export const dayTokenSql = `SELECT json_object(
 'b',(SELECT json_group_array(json_array(id,revision,status)) FROM (SELECT id,revision,status FROM production_batches WHERE day BETWEEN date(?,'-14 days') AND ? ORDER BY id)),
 'm',(SELECT json_group_array(json_array(batch_id,revision,consumption_id)) FROM (SELECT batch_id,revision,consumption_id FROM production_materials WHERE day=? ORDER BY batch_id)),
 'o',(SELECT json_group_array(json_array(id,revision,status)) FROM (SELECT id,revision,status FROM orders WHERE date=? ORDER BY id)),
 'c',(SELECT json_group_array(json_array(day,revision,status)) FROM (SELECT day,revision,status FROM production_day_closes WHERE day BETWEEN date(?,'-14 days') AND ? ORDER BY day)),
 's',COALESCE((SELECT revision FROM production_settings WHERE id=1),0)) AS token`;
export const dayTokenBinds = (day:string) => [day,day,day,day,day,day];
