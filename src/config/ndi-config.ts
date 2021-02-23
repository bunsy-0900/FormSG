// Mapping between form field types and MyInfo field types
// TODO: childrenbirthrecords, relationships
export const FIELD_MAPPING = {
  dropdown: [
    'sex',
    'race',
    'dialect',
    'nationality',
    'birthcountry',
    'secondaryrace',
    'residentialstatus',
    'housingtype',
    'hdbtype',
    'marital',
    'countryofmarriage',
    'workpassstatus',
    'householdincome',
    'occupation',
  ],
  textfield: [
    'name',
    'marriedname',
    'hanyupinyinname',
    'aliasname',
    'hanyupinyinaliasname',
    'passportnumber',
    'regadd',
    'employment',
    'vehno',
    'marriagecertno',
  ],
  mobile: ['mobileno'],
  date: [
    'dob',
    'passportexpirydate',
    'marriagedate',
    'divorcedate',
    'workpassexpirydate',
  ],
}
